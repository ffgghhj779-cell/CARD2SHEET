import fs from "node:fs";
import { google, type sheets_v4 } from "googleapis";
import { config } from "./config";
import { DECISION, LEVELS, SECTOR_NAMES, SUMMARY_TAB, levelRank } from "./taxonomy";
import { HEADERS, KEYS, type Row } from "./types";

const SHEET_HEADERS = [...HEADERS, "معرّف"]; // last col: stable key "web-<id>" used to locate a row in the master tab
const colLetter = (n: number) => {
  let s = "";
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const LAST_COL = colLetter(SHEET_HEADERS.length);
const ID_COL = LAST_COL;
const q = (title: string) => `'${title.replace(/'/g, "''")}'`;
const master = () => config.worksheet;
const rowKey = (id: number) => `web-${id}`;
const values = (r: Row) => [...KEYS.map((k) => r[k] ?? ""), rowKey(r.id)];

/** Sort inside a sector tab: top management first, decision makers first, then newest. */
export const sortForTab = (rows: Row[]) =>
  [...rows].sort(
    (a, b) =>
      levelRank(a.management_level) - levelRank(b.management_level) ||
      (a.decision_maker === "نعم" ? 0 : 1) - (b.decision_maker === "نعم" ? 0 : 1) ||
      b.id - a.id,
  );

let api: sheets_v4.Sheets | null = null;
let tabs: Map<string, number> | null = null; // title -> gid
let masterChecked: Promise<boolean> | null = null;
let rebuildNeeded = false;
export const takeRebuildFlag = () => {
  const r = rebuildNeeded;
  rebuildNeeded = false;
  return r;
};

function client(): sheets_v4.Sheets {
  if (!api) {
    const credentials = JSON.parse(config.saJson || fs.readFileSync(config.saFile, "utf8"));
    const auth = new google.auth.GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
    api = google.sheets({ version: "v4", auth });
  }
  return api;
}

/** Retry Google API calls on quota (429) and transient 5xx errors. */
async function g<T>(fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let i = 0; i < 5; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const code = (e as { code?: number; status?: number }).code ?? (e as { status?: number }).status;
      if (code && code !== 429 && code < 500) throw e;
      await new Promise((r) => setTimeout(r, 1500 * 2 ** i));
    }
  }
  throw last;
}

async function loadTabs(): Promise<Map<string, number>> {
  if (tabs) return tabs;
  const meta = await g(() => client().spreadsheets.get({ spreadsheetId: config.sheetId, fields: "sheets.properties" }));
  tabs = new Map((meta.data.sheets ?? []).map((s) => [s.properties!.title!, s.properties!.sheetId!]));
  return tabs;
}

const HEADER_FMT = (gid: number, color = { red: 0.12, green: 0.31, blue: 0.47 }, cols = SHEET_HEADERS.length) => [
  {
    updateSheetProperties: {
      properties: { sheetId: gid, rightToLeft: true, gridProperties: { frozenRowCount: 1 } },
      fields: "rightToLeft,gridProperties.frozenRowCount",
    },
  },
  {
    repeatCell: {
      range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1 },
      cell: {
        userEnteredFormat: {
          backgroundColor: color,
          horizontalAlignment: "CENTER",
          textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
        },
      },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
    },
  },
  {
    updateDimensionProperties: {
      range: { sheetId: gid, dimension: "COLUMNS", startIndex: 0, endIndex: cols },
      properties: { pixelSize: 150 },
      fields: "pixelSize",
    },
  },
];

async function ensureTabsBatch(
  specs: { title: string; index?: number; color?: { red: number; green: number; blue: number }; cols?: number }[],
) {
  const t = await loadTabs();
  const missing = specs.filter((s) => !t.has(s.title));
  if (!missing.length) return;

  // Rename Sheet1 if it exists and master() is requested
  const mIdx = missing.findIndex((s) => s.title === master() && t.has("Sheet1"));
  if (mIdx >= 0) {
    const gid = t.get("Sheet1")!;
    await g(() =>
      client().spreadsheets.batchUpdate({
        spreadsheetId: config.sheetId,
        requestBody: {
          requests: [
            { updateSheetProperties: { properties: { sheetId: gid, title: master(), index: 0 }, fields: "title,index" } },
            ...HEADER_FMT(gid, missing[mIdx].color, missing[mIdx].cols),
          ],
        },
      }),
    );
    t.delete("Sheet1");
    t.set(master(), gid);
    missing.splice(mIdx, 1);
  }
  if (!missing.length) return;

  const r = await g(() =>
    client().spreadsheets.batchUpdate({
      spreadsheetId: config.sheetId,
      requestBody: {
        requests: missing.map((s) => ({
          addSheet: { properties: { title: s.title, ...(s.index != null ? { index: s.index } : {}) } },
        })),
      },
    }),
  );
  const fmtRequests: sheets_v4.Schema$Request[] = [];
  (r.data.replies ?? []).forEach((rep, i) => {
    const gid = rep.addSheet?.properties?.sheetId;
    if (gid != null) {
      t.set(missing[i].title, gid);
      fmtRequests.push(...HEADER_FMT(gid, missing[i].color, missing[i].cols));
    }
  });
  if (fmtRequests.length) {
    await g(() => client().spreadsheets.batchUpdate({ spreadsheetId: config.sheetId, requestBody: { requests: fmtRequests } }));
  }
}

async function writeTabsBatch(items: { title: string; matrix: (string | number)[][] }[]) {
  if (!items.length) return;
  await g(() =>
    client().spreadsheets.values.batchClear({
      spreadsheetId: config.sheetId,
      requestBody: { ranges: items.map((x) => `${q(x.title)}!A1:ZZ`) },
    }),
  );
  await g(() =>
    client().spreadsheets.values.batchUpdate({
      spreadsheetId: config.sheetId,
      requestBody: {
        valueInputOption: "RAW",
        data: items.map((x) => ({ range: `${q(x.title)}!A1`, values: x.matrix })),
      },
    }),
  );
}

async function ensureMaster(): Promise<boolean> {
  masterChecked ??= (async () => {
    await ensureTabsBatch([{ title: master(), index: 0 }]);
    const gid = (await loadTabs()).get(master())!;
    const hdr = await g(() =>
      client().spreadsheets.values.get({
        spreadsheetId: config.sheetId,
        range: `${q(master())}!A1:${colLetter(SHEET_HEADERS.length + 6)}1`,
      }),
    );
    if (JSON.stringify(hdr.data.values?.[0] ?? []) === JSON.stringify(SHEET_HEADERS)) return false;
    await g(() =>
      client().spreadsheets.values.update({
        spreadsheetId: config.sheetId,
        range: `${q(master())}!A1`,
        valueInputOption: "RAW",
        requestBody: { values: [SHEET_HEADERS] },
      }),
    );
    await g(() =>
      client().spreadsheets.batchUpdate({
        spreadsheetId: config.sheetId,
        requestBody: { requests: HEADER_FMT(gid) },
      }),
    );
    rebuildNeeded = true;
    return true;
  })();
  try {
    return await masterChecked;
  } catch (e) {
    masterChecked = null;
    throw e;
  }
}

function reset(label: string, e: unknown): false {
  api = null;
  tabs = null;
  masterChecked = null;
  console.error(`Sheets ${label} failed:`, e instanceof Error ? e.message : e);
  return false;
}

async function positions(): Promise<Map<string, number>> {
  const col = await g(() => client().spreadsheets.values.get({ spreadsheetId: config.sheetId, range: `${q(master())}!${ID_COL}:${ID_COL}` }));
  const pos = new Map<string, number>();
  (col.data.values ?? []).forEach((v, i) => pos.set(String(v[0] ?? ""), i + 1));
  return pos;
}

// ---------------- master tab (incremental) ----------------
export async function appendRows(rows: Row[]): Promise<boolean> {
  if (!rows.length || !config.sheetId) return false;
  try {
    if (await ensureMaster()) return false;
    await g(() =>
      client().spreadsheets.values.append({
        spreadsheetId: config.sheetId,
        range: `${q(master())}!A1`,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: rows.map(values) },
      }),
    );
    return true;
  } catch (e) {
    return reset("append", e);
  }
}

export async function updateRows(rows: Row[]): Promise<boolean> {
  if (!rows.length || !config.sheetId) return false;
  try {
    if (await ensureMaster()) return false;
    const pos = await positions();
    const present = rows.filter((r) => pos.has(rowKey(r.id)));
    const missing = rows.filter((r) => !pos.has(rowKey(r.id)));
    if (present.length) {
      await g(() =>
        client().spreadsheets.values.batchUpdate({
          spreadsheetId: config.sheetId,
          requestBody: {
            valueInputOption: "RAW",
            data: present.map((r) => ({ range: `${q(master())}!A${pos.get(rowKey(r.id))}:${LAST_COL}`, values: [values(r)] })),
          },
        }),
      );
    }
    return missing.length ? appendRows(missing) : true;
  } catch (e) {
    return reset("update", e);
  }
}

export async function deleteRows(ids: number[]): Promise<boolean> {
  if (!ids.length || !config.sheetId) return true;
  try {
    await ensureMaster();
    const gid = (await loadTabs()).get(master())!;
    const pos = await positions();
    const idx = ids.map((i) => pos.get(rowKey(i))).filter((x): x is number => !!x).sort((a, b) => b - a);
    if (idx.length) {
      await g(() =>
        client().spreadsheets.batchUpdate({
          spreadsheetId: config.sheetId,
          requestBody: { requests: idx.map((r) => ({ deleteDimension: { range: { sheetId: gid, dimension: "ROWS", startIndex: r - 1, endIndex: r } } })) },
        }),
      );
    }
    return true;
  } catch (e) {
    return reset("delete", e);
  }
}

// ---------------- sector tabs + summary (batched) ----------------
export async function rebuildSectorTabs(sectors: string[], rowsOf: (s: string) => Row[]): Promise<boolean> {
  if (!config.sheetId) return false;
  try {
    const uniq = [...new Set(sectors)].filter(Boolean);
    const nonEmpty = uniq.map((s) => ({ s, rows: rowsOf(s) })).filter((x) => x.rows.length > 0);
    const empty = uniq.filter((s) => !nonEmpty.some((x) => x.s === s));

    await ensureTabsBatch(nonEmpty.map((x) => ({ title: x.s, color: { red: 0.18, green: 0.49, blue: 0.2 } })));
    await writeTabsBatch(nonEmpty.map((x) => ({ title: x.s, matrix: [SHEET_HEADERS, ...sortForTab(x.rows).map(values)] })));

    const t = await loadTabs();
    const delReqs = empty
      .filter((s) => t.has(s))
      .map((s) => {
        const gid = t.get(s)!;
        t.delete(s);
        return { deleteSheet: { sheetId: gid } };
      });
    if (delReqs.length) {
      await g(() => client().spreadsheets.batchUpdate({ spreadsheetId: config.sheetId, requestBody: { requests: delReqs } }));
    }
    return true;
  } catch (e) {
    return reset("sector tabs", e);
  }
}

export function summaryMatrix(all: Row[]): (string | number)[][] {
  const head = ["القطاع", ...LEVELS, `صناع القرار (${DECISION[0]})`, "الإجمالي"];
  const used = SECTOR_NAMES.filter((s) => all.some((r) => r.sector === s));
  const body = used.map((s) => {
    const rs = all.filter((r) => r.sector === s);
    return [s, ...LEVELS.map((l) => rs.filter((r) => r.management_level === l).length), rs.filter((r) => r.decision_maker === "نعم").length, rs.length];
  });
  body.sort((a, b) => (b[b.length - 1] as number) - (a[a.length - 1] as number));
  const total = ["الإجمالي", ...LEVELS.map((l) => all.filter((r) => r.management_level === l).length), all.filter((r) => r.decision_maker === "نعم").length, all.length];
  return [head, ...body, total];
}

let summaryTimer: NodeJS.Timeout | null = null;
export function scheduleSummary(getAll: () => Row[], delayMs = 4000) {
  if (summaryTimer) clearTimeout(summaryTimer);
  summaryTimer = setTimeout(() => {
    summaryTimer = null;
    rebuildSummary(getAll()).catch(() => {});
  }, delayMs);
}

export async function rebuildSummary(all: Row[]): Promise<boolean> {
  if (!config.sheetId) return false;
  try {
    const matrix = summaryMatrix(all);
    await ensureTabsBatch([{ title: SUMMARY_TAB, index: 1, color: { red: 0.42, green: 0.11, blue: 0.6 }, cols: matrix[0].length }]);
    await writeTabsBatch([{ title: SUMMARY_TAB, matrix }]);
    return true;
  } catch (e) {
    return reset("summary", e);
  }
}

/** Full rewrite of every managed tab from the DB in a few batched API calls. */
export async function rebuildAll(all: Row[]): Promise<boolean> {
  if (!config.sheetId) return false;
  try {
    await ensureMaster();
    const sumMatrix = summaryMatrix(all);
    const used = SECTOR_NAMES.filter((s) => all.some((r) => r.sector === s));

    await ensureTabsBatch([
      { title: master(), index: 0 },
      { title: SUMMARY_TAB, index: 1, color: { red: 0.42, green: 0.11, blue: 0.6 }, cols: sumMatrix[0].length },
      ...used.map((s) => ({ title: s, color: { red: 0.18, green: 0.49, blue: 0.2 } })),
    ]);

    await writeTabsBatch([
      { title: master(), matrix: [SHEET_HEADERS, ...all.map(values)] },
      { title: SUMMARY_TAB, matrix: sumMatrix },
      ...used.map((s) => ({ title: s, matrix: [SHEET_HEADERS, ...sortForTab(all.filter((r) => r.sector === s)).map(values)] })),
    ]);

    const t = await loadTabs();
    const stale = [...t.keys()].filter((k) => SECTOR_NAMES.includes(k) && !used.includes(k));
    if (stale.length) {
      const delReqs = stale.map((s) => {
        const gid = t.get(s)!;
        t.delete(s);
        return { deleteSheet: { sheetId: gid } };
      });
      await g(() => client().spreadsheets.batchUpdate({ spreadsheetId: config.sheetId, requestBody: { requests: delReqs } }));
    }
    return true;
  } catch (e) {
    return reset("rebuild", e);
  }
}

/** Test helper: read a tab. */
export async function readTab(title = master()): Promise<string[][]> {
  const r = await g(() => client().spreadsheets.values.get({ spreadsheetId: config.sheetId, range: `${q(title)}!A1:${LAST_COL}` }));
  return (r.data.values ?? []) as string[][];
}
export const readAll = () => readTab();
export async function listTabs(): Promise<string[]> {
  tabs = null;
  return [...(await loadTabs()).keys()];
}
