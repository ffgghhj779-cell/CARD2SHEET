"""SQLite = local source of truth (works offline, powers /export, dedupe, retry of failed Sheets syncs)."""
import re
import sqlite3
from datetime import datetime

from . import config
from .schema import Lead

COLUMNS = [
    ("scanned_at", "Scanned At"),
    ("scanned_by", "Scanned By"),
    ("full_name_ar", "الاسم (عربي)"),
    ("full_name_en", "Name (English)"),
    ("job_title", "Job Title"),
    ("company_name", "Company"),
    ("industry_category", "Industry"),
    ("primary_phone", "Primary Phone"),
    ("secondary_phones", "Other Phones"),
    ("email", "Email"),
    ("website", "Website"),
    ("city_country", "City / Country"),
    ("full_address", "Address"),
    ("card_type", "Card Type"),
    ("notes", "Notes"),
]
KEYS = [k for k, _ in COLUMNS]
HEADERS = [h for _, h in COLUMNS]


def _conn():
    c = sqlite3.connect(config.DB_PATH)
    c.row_factory = sqlite3.Row
    c.execute(
        f"""CREATE TABLE IF NOT EXISTS leads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            dedupe_key TEXT UNIQUE,
            synced INTEGER DEFAULT 0,
            notes_pending INTEGER DEFAULT 0,
            {", ".join(f"{k} TEXT" for k in KEYS)})"""
    )
    cols = {r[1] for r in c.execute("PRAGMA table_info(leads)")}
    if "notes_pending" not in cols:  # migrate DBs created by v1
        c.execute("ALTER TABLE leads ADD COLUMN notes_pending INTEGER DEFAULT 0")
    return c


def _key(l: Lead) -> str:
    digits = re.sub(r"\D", "", l.primary_phone)
    if digits:
        return "p:" + digits
    if l.email:
        return "e:" + l.email
    return "n:" + re.sub(r"\s+", "", (l.company_name + l.full_name_en + l.full_name_ar).lower())


def to_row(l: Lead, user: str) -> dict:
    d = l.model_dump()
    d["secondary_phones"] = " | ".join(d["secondary_phones"])
    d["scanned_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    d["scanned_by"] = user
    return d


def add(l: Lead, user: str) -> tuple[int, bool, dict]:
    """Returns (row_id, is_new, row). For duplicates row_id is the EXISTING lead's id."""
    row = to_row(l, user)
    with _conn() as c:
        try:
            cur = c.execute(
                f"INSERT INTO leads (dedupe_key, {', '.join(KEYS)}) VALUES (?, {', '.join('?' * len(KEYS))})",
                [_key(l)] + [row[k] for k in KEYS],
            )
            row["id"] = cur.lastrowid
            return cur.lastrowid, True, row
        except sqlite3.IntegrityError:
            r = c.execute("SELECT id FROM leads WHERE dedupe_key=?", (_key(l),)).fetchone()
            row["id"] = r["id"]
            return r["id"], False, row


def append_note(ids: list[int], text: str) -> list[tuple[int, str, bool]]:
    """Append text to notes of the given leads. Returns [(id, new_notes, already_in_sheet)]."""
    out = []
    with _conn() as c:
        for i in ids:
            r = c.execute("SELECT notes, synced FROM leads WHERE id=?", (i,)).fetchone()
            if not r:
                continue
            notes = f"{r['notes']} | {text}" if r["notes"] else text
            c.execute("UPDATE leads SET notes=?, notes_pending=1 WHERE id=?", (notes, i))
            out.append((i, notes, bool(r["synced"])))
    return out


def clear_notes_pending(ids: list[int]):
    with _conn() as c:
        c.executemany("UPDATE leads SET notes_pending=0 WHERE id=?", [(i,) for i in ids])


def pending_notes() -> list[tuple[int, str]]:
    with _conn() as c:
        return [
            (r["id"], r["notes"])
            for r in c.execute("SELECT id, notes FROM leads WHERE synced=1 AND notes_pending=1")
        ]


def mark_synced(ids: list[int]):
    # a freshly appended sheet row already contains the latest notes
    with _conn() as c:
        c.executemany("UPDATE leads SET synced=1, notes_pending=0 WHERE id=?", [(i,) for i in ids])


def unsynced() -> list[tuple[int, dict]]:
    with _conn() as c:
        return [(r["id"], dict(r)) for r in c.execute("SELECT * FROM leads WHERE synced=0 ORDER BY id")]


def all_rows() -> list[dict]:
    with _conn() as c:
        return [dict(r) for r in c.execute("SELECT * FROM leads ORDER BY id")]
