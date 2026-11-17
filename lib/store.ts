import { DatabaseSync } from "node:sqlite";
import { config } from "./config";
import { KEYS, type Key, type Lead, type Row } from "./types";

// SQLite (Node's built-in node:sqlite, Node >= 22.5) = local source of truth + the bot's long-term memory.
const db = new DatabaseSync(config.dbPath);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA busy_timeout = 5000");

function tx<T>(fn: () => T): T {
  db.exec("BEGIN");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

db.exec(`CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key TEXT UNIQUE,
  synced INTEGER DEFAULT 0,
  notes_pending INTEGER DEFAULT 0,
  ${KEYS.map((k) => `${k} TEXT`).join(", ")}
)`);
// Bot memory: last batch per user + which Telegram messages refer to which leads (for reply-to targeting).
db.exec(`CREATE TABLE IF NOT EXISTS user_memory (user_id TEXT PRIMARY KEY, last_ids TEXT, last_at INTEGER)`);
db.exec(`CREATE TABLE IF NOT EXISTS message_map (chat_id TEXT, message_id INTEGER, lead_ids TEXT, PRIMARY KEY (chat_id, message_id))`);

const AR_IND = /[٠-٩۰-۹]/g;
const toLatinDigits = (s: string) =>
  s.replace(AR_IND, (c) => String("٠١٢٣٤٥٦٧٨٩".includes(c) ? "٠١٢٣٤٥٦٧٨٩".indexOf(c) : "۰۱۲۳۴۵۶۷۸۹".indexOf(c)));
const digits = (s: string) => toLatinDigits(s).replace(/\D/g, "");
const normName = (s: string) => s.toLowerCase().replace(/[\s\-_.'"`]/g, "");

function dedupeKey(l: Lead): string {
  const d = digits(l.primary_phone);
  if (d.length >= 7) return "p:" + d; // phones are already normalized to E.164 (+country_code...) by phones.ts
  if (l.email) return "e:" + l.email.toLowerCase();
  return "n:" + normName(l.company_name + l.full_name_en + l.full_name_ar);
}

const now = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

function toRow(l: Lead, user: string): Omit<Row, "id"> {
  return { ...l, secondary_phones: l.secondary_phones.join(" | "), scanned_at: now(), scanned_by: user };
}

export const getRow = (id: number) =>
  db.prepare("SELECT * FROM leads WHERE id=?").get(id) as unknown as Row | undefined;
export const getRows = (ids: number[]) => ids.map(getRow).filter(Boolean) as Row[];

/** Find an existing lead matching ANY of the phones / email of the new lead (not only the primary key). */
function findExisting(l: Lead): Row | undefined {
  const byKey = db.prepare("SELECT * FROM leads WHERE dedupe_key=?").get(dedupeKey(l)) as unknown as Row | undefined;
  if (byKey) return byKey;
  const phones = [l.primary_phone, ...l.secondary_phones].map(digits).filter((d) => d.length >= 7);
  for (const r of db.prepare("SELECT * FROM leads").all() as unknown as Row[]) {
    const theirs = [r.primary_phone, ...(r.secondary_phones || "").split("|")].map(digits).filter((d) => d.length >= 7);
    if (phones.some((p) => theirs.includes(p))) return r;
    if (l.email && r.email && l.email.toLowerCase() === r.email.toLowerCase()) return r;
  }
  return undefined;
}

const MERGE_FIELDS: Key[] = [
  "full_name_ar", "full_name_en", "job_title", "company_name", "industry_category",
  "email", "website", "city_country", "full_address",
];

/** Insert, or merge into an existing lead (fills empty fields, adds new phones/notes). */
export function addLead(
  l: Lead,
  user: string,
): { id: number; isNew: boolean; changed: boolean; row: Row } {
  return tx(() => {
    const ex = findExisting(l);
    if (!ex) {
      const row = toRow(l, user);
      const r = db
        .prepare(`INSERT INTO leads (dedupe_key, ${KEYS.join(",")}) VALUES (?, ${KEYS.map(() => "?").join(",")})`)
        .run(dedupeKey(l), ...KEYS.map((k) => row[k]));
      const id = Number(r.lastInsertRowid);
      return { id, isNew: true, changed: true, row: getRow(id)! };
    }
    const upd: Partial<Record<Key, string>> = {};
    for (const f of MERGE_FIELDS) if (!ex[f] && (l as unknown as Record<string, string>)[f]) upd[f] = (l as unknown as Record<string, string>)[f];
    const known = new Set([ex.primary_phone, ...(ex.secondary_phones || "").split(" | ")].map(digits).filter(Boolean));
    const extra = [l.primary_phone, ...l.secondary_phones].filter((p) => p && !known.has(digits(p)));
    if (!ex.primary_phone && extra.length) upd.primary_phone = extra.shift()!;
    if (extra.length) upd.secondary_phones = [ex.secondary_phones, ...extra].filter(Boolean).join(" | ");
    if (l.notes && !(ex.notes || "").includes(l.notes)) upd.notes = ex.notes ? `${ex.notes} | ${l.notes}` : l.notes;
    const changed = Object.keys(upd).length > 0;
    if (changed) updateFields(ex.id, upd);
    return { id: ex.id, isNew: false, changed, row: getRow(ex.id)! };
  });
}

/** Update arbitrary fields; marks the row dirty so the Google Sheets row gets rewritten. */
export function updateFields(id: number, fields: Partial<Record<Key, string>>) {
  const keys = (Object.keys(fields) as Key[]).filter((k) => KEYS.includes(k));
  if (!keys.length) return;
  db.prepare(`UPDATE leads SET ${keys.map((k) => `${k}=?`).join(", ")}, notes_pending=1 WHERE id=?`).run(
    ...keys.map((k) => fields[k] ?? ""),
    id,
  );
}

export function appendNote(ids: number[], text: string): Row[] {
  return tx(() => {
    for (const id of ids) {
      const r = getRow(id);
      if (!r) continue;
      updateFields(id, { notes: r.notes ? `${r.notes} | ${text}` : text });
    }
    return getRows(ids);
  });
}

export function deleteLeads(ids: number[]) {
  const st = db.prepare("DELETE FROM leads WHERE id=?");
  tx(() => ids.forEach((i) => st.run(i)));
}

const idsRun = (sql: string, ids: number[]) => {
  const st = db.prepare(sql);
  tx(() => ids.forEach((i) => st.run(i)));
};
export const markSynced = (ids: number[]) => idsRun("UPDATE leads SET synced=1, notes_pending=0 WHERE id=?", ids);
export const clearDirty = (ids: number[]) => idsRun("UPDATE leads SET notes_pending=0 WHERE id=?", ids);

export const unsynced = () => db.prepare("SELECT * FROM leads WHERE synced=0 ORDER BY id").all() as unknown as Row[];
export const dirtyRows = () =>
  db.prepare("SELECT * FROM leads WHERE synced=1 AND notes_pending=1 ORDER BY id").all() as unknown as Row[];
export const allRows = () => db.prepare("SELECT * FROM leads ORDER BY id").all() as unknown as Row[];

const normAr = (s: string) =>
  toLatinDigits(s || "")
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي");

const STOP_WORDS = new Set(["شركه", "مؤسسه", "مكتب", "عميل", "العميل", "company", "co", "est", "llc", "من", "في", "عن"]);

export function search(q: string, limit = 10): Row[] {
  const d = digits(q);
  const cleaned = normAr(q);
  const tokens = cleaned
    .split(/[\s,،.\-_/]+/)
    .map((t) => t.replace(/^ال/, ""))
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t) && !STOP_WORDS.has("ال" + t));

  const all = db.prepare("SELECT * FROM leads ORDER BY id DESC").all() as unknown as Row[];
  const scored: { row: Row; score: number }[] = [];

  for (const r of all) {
    const hay = normAr(
      `${r.full_name_ar} ${r.full_name_en} ${r.company_name} ${r.job_title} ${r.email} ${r.industry_category} ${r.city_country} ${r.full_address} ${r.notes}`,
    );
    const phoneHay = digits(`${r.primary_phone} ${r.secondary_phones}`);
    let score = 0;
    if (cleaned && hay.includes(cleaned)) score += 10;
    for (const tok of tokens) {
      if (hay.includes(tok)) score += 3;
    }
    if (d.length >= 4 && phoneHay.includes(d)) score += 10;
    if (score > 0) scored.push({ row: r, score });
  }

  scored.sort((a, b) => b.score - a.score || b.row.id - a.row.id);
  return scored.slice(0, limit).map((s) => s.row);
}

// ---------- memory ----------
export function setLastScan(userId: string | number, ids: number[]) {
  db.prepare("INSERT INTO user_memory (user_id, last_ids, last_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET last_ids=excluded.last_ids, last_at=excluded.last_at")
    .run(String(userId), JSON.stringify(ids), Date.now());
}
export function touchLastScan(userId: string | number) {
  db.prepare("UPDATE user_memory SET last_at=? WHERE user_id=?").run(Date.now(), String(userId));
}
export function getLastScan(userId: string | number): { ids: number[]; at: number } | null {
  const r = db.prepare("SELECT last_ids, last_at FROM user_memory WHERE user_id=?").get(String(userId)) as
    | { last_ids: string; last_at: number }
    | undefined;
  if (!r) return null;
  const ids = (JSON.parse(r.last_ids) as number[]).filter((i) => getRow(i));
  return ids.length ? { ids, at: r.last_at } : null;
}
export function mapMessage(chatId: string | number, messageId: number, ids: number[]) {
  db.prepare("INSERT OR REPLACE INTO message_map (chat_id, message_id, lead_ids) VALUES (?, ?, ?)").run(String(chatId), messageId, JSON.stringify(ids));
}
export function idsForMessage(chatId: string | number, messageId: number): number[] | null {
  const r = db.prepare("SELECT lead_ids FROM message_map WHERE chat_id=? AND message_id=?").get(String(chatId), messageId) as
    | { lead_ids: string }
    | undefined;
  if (!r) return null;
  const ids = (JSON.parse(r.lead_ids) as number[]).filter((i) => getRow(i));
  return ids.length ? ids : null;
}
