import asyncio
import logging

import gspread

from . import config
from .store import HEADERS, KEYS

log = logging.getLogger(__name__)
SHEET_HEADERS = HEADERS + ["Lead ID"]  # col P: stable key ("tg-<id>") used to find a row when updating notes
NOTES_COL = KEYS.index("notes") + 1  # 15 -> column O
ID_COL = len(SHEET_HEADERS)  # 16 -> column P
_ws = None


def _worksheet():
    global _ws
    if _ws is None:
        gc = gspread.service_account(filename=config.SA_FILE)
        sh = gc.open_by_key(config.SHEET_ID)
        try:
            _ws = sh.worksheet(config.WORKSHEET)
        except gspread.WorksheetNotFound:
            _ws = sh.add_worksheet(config.WORKSHEET, rows=1000, cols=len(SHEET_HEADERS))
        if _ws.row_values(1) != SHEET_HEADERS:
            _ws.update([SHEET_HEADERS], "A1")
            _ws.freeze(rows=1)
            _ws.format("A1:P1", {"textFormat": {"bold": True}})
    return _ws


def _append(rows: list[dict]):
    # RAW keeps "+966..." exactly as text.
    values = [[r[k] for k in KEYS] + [f"tg-{r['id']}"] for r in rows]
    _worksheet().append_rows(values, value_input_option="RAW", table_range="A1")


def _update_notes(pairs: list[tuple[int, str]]):
    ws = _worksheet()
    pos = {v: i + 1 for i, v in enumerate(ws.col_values(ID_COL))}
    data = [
        {"range": f"O{pos[f'tg-{i}']}", "values": [[notes]]}
        for i, notes in pairs
        if f"tg-{i}" in pos  # row deleted by user -> nothing to update
    ]
    if data:
        ws.batch_update(data, value_input_option="RAW")


def _reset():
    global _ws
    _ws = None  # force re-auth next time


async def append_rows(rows: list[dict]) -> bool:
    """Real-time append. Returns False on failure (rows stay unsynced in SQLite for /sync)."""
    if not rows or not config.SHEET_ID:
        return False
    try:
        await asyncio.to_thread(_append, rows)
        return True
    except Exception as e:
        _reset()
        log.error("Sheets append failed: %s", e)
        return False


async def update_notes(pairs: list[tuple[int, str]]) -> bool:
    if not pairs or not config.SHEET_ID:
        return False
    try:
        await asyncio.to_thread(_update_notes, pairs)
        return True
    except Exception as e:
        _reset()
        log.error("Sheets notes update failed: %s", e)
        return False
