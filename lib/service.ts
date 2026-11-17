import * as sheets from "./sheets";
import * as store from "./store";
import type { Lead, Row } from "./types";

export type SheetStatus = "ok" | "pending";

/** Push one set of rows: new rows are appended, already-synced rows are rewritten in place. */
export async function pushRows(rows: Row[]): Promise<SheetStatus> {
  const fresh = rows.filter((r) => !r.synced);
  const old = rows.filter((r) => r.synced);
  let ok = true;
  if (fresh.length) {
    if (await sheets.appendRows(fresh)) store.markSynced(fresh.map((r) => r.id));
    else ok = false;
  }
  if (old.length) {
    if (await sheets.updateRows(old)) store.clearDirty(old.map((r) => r.id));
    else ok = false;
  }
  return ok ? "ok" : "pending";
}

/** Save extracted leads (insert or merge) and sync them to Sheets. */
export async function saveLeads(leads: Lead[], user: string) {
  const results = leads.map((l) => store.addLead(l, user));
  const toPush = store.getRows([...new Set(results.filter((r) => r.isNew || r.changed).map((r) => r.id))]);
  const sheet = toPush.length ? await pushRows(toPush) : "ok";
  const ids = [...new Set(results.map((r) => r.id))];
  return { results: results.map((r) => ({ ...r, row: store.getRow(r.id)! })), ids, sheet };
}

/** Append "[label] text" to the notes of existing leads (SQLite + their Google Sheets rows). */
export async function attachNote(ids: number[], label: string, text: string) {
  const rows = store.appendNote(ids, `[${label}] ${text}`);
  const sheet = await pushRows(rows);
  return { updated: rows, sheet };
}

export async function applyCorrections(ids: number[], fields: Partial<Record<string, string>>) {
  for (const id of ids) store.updateFields(id, fields as never);
  const rows = store.getRows(ids);
  return { updated: rows, sheet: await pushRows(rows) };
}

export async function removeLeads(ids: number[]) {
  const ok = await sheets.deleteRows(ids);
  store.deleteLeads(ids);
  return ok;
}

export async function syncAll() {
  const rows = store.unsynced();
  const dirty = store.dirtyRows();
  if (!rows.length && !dirty.length) return { ok: true, appended: 0, notes: 0 };
  const status = await pushRows([...rows, ...dirty]);
  return { ok: status === "ok", appended: rows.length, notes: dirty.length };
}
