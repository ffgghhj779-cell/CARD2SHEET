import * as sheets from "./sheets";
import * as store from "./store";
import type { Lead, Row } from "./types";
import { classifyLead } from "./vision";

export type SheetStatus = "ok" | "pending";

// All Google Sheets writes go through one queue => tabs never race each other.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function fullRebuild(): Promise<boolean> {
  const all = store.allRows();
  const ok = await sheets.rebuildAll(all);
  if (ok) {
    store.markSynced(all.map((r) => r.id));
    for (const s of new Set(all.map((r) => r.sector))) store.setSheetTab(all.filter((r) => r.sector === s).map((r) => r.id), s);
  }
  return ok;
}

/** Push rows: master tab incremental, affected sector tabs rebuilt (handles moves between sectors), summary debounced. */
export function pushRows(rows: Row[], extraSectors: string[] = []): Promise<SheetStatus> {
  return serial(async () => {
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
    if (sheets.takeRebuildFlag()) return (await fullRebuild()) ? "ok" : "pending"; // schema/header migration

    const affected = [...rows.map((r) => r.sector), ...rows.map((r) => r.sheet_tab ?? ""), ...extraSectors].filter(Boolean);
    if (affected.length) {
      if (await sheets.rebuildSectorTabs(affected, store.rowsBySector)) {
        for (const r of rows) store.setSheetTab([r.id], r.sector);
      } else {
        ok = false;
        for (const r of rows) store.setSheetTab([r.id], ""); // forces this tab to be rebuilt by the next sync
      }
    }
    sheets.scheduleSummary(store.allRows);
    return ok ? "ok" : "pending";
  });
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
  return { updated: store.getRows(ids), sheet };
}

export async function applyCorrections(ids: number[], fields: Partial<Record<string, string>>) {
  const oldSectors = store.getRows(ids).map((r) => r.sector);
  for (const id of ids) store.updateFields(id, fields as never);
  const rows = store.getRows(ids);
  const sheet = await pushRows(rows, oldSectors);
  return { updated: store.getRows(ids), sheet };
}

export async function removeLeads(ids: number[]) {
  const sectors = store.getRows(ids).map((r) => r.sector);
  return serial(async () => {
    const ok = await sheets.deleteRows(ids);
    store.deleteLeads(ids);
    await sheets.rebuildSectorTabs(sectors, store.rowsBySector);
    sheets.scheduleSummary(store.allRows, 500);
    return ok;
  });
}

export async function syncAll() {
  const rows = store.unsynced();
  const dirty = store.dirtyRows();
  const untabbed = store.allRows().filter((r) => r.synced && r.sheet_tab !== r.sector);
  const all = [...new Map([...rows, ...dirty, ...untabbed].map((r) => [r.id, r])).values()];
  if (!all.length) return { ok: true, appended: 0, notes: 0 };
  const status = await pushRows(all);
  return { ok: status === "ok", appended: rows.length, notes: dirty.length + untabbed.length };
}

export const rebuildEverything = () => serial(fullRebuild);

/** Classify leads saved before the classification feature existed (in parallel batches of 10), then rebuild all tabs once. */
export async function backfillClassification(log = console.log): Promise<number> {
  const todo = store.unclassified();
  if (!todo.length) return 0;
  log(`🏷 Classifying ${todo.length} existing lead(s)…`);
  const BATCH = 10;
  for (let i = 0; i < todo.length; i += BATCH) {
    const slice = todo.slice(i, i + BATCH);
    await Promise.all(
      slice.map(async (r) => {
        try {
          const c = await classifyLead(r);
          store.setClassification(r.id, {
            sector: c.sector!,
            industry_category: r.industry_category || c.industry_category!,
            management_level: c.management_level!,
            department: c.department!,
            decision_maker: c.decision_maker!,
          });
        } catch (e) {
          log(`classification failed for #${r.id}: ${e instanceof Error ? e.message : e}`);
        }
      }),
    );
    log(`🏷 Classified ${Math.min(i + BATCH, todo.length)} / ${todo.length}`);
  }
  await rebuildEverything();
  return todo.length;
}
