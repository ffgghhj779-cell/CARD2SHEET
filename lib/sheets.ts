import fs from "node:fs";
import { google, type sheets_v4 } from "googleapis";
import { config } from "./config";
import { HEADERS, KEYS, type Row } from "./types";

const SHEET_HEADERS = [...HEADERS, "Lead ID"]; // col P: stable key "web-<id>" used to locate a row for updates
const LAST_COL = "P";
const ID_COL = "P";
const tab = () => `'${config.worksheet.replace(/'/g, "''")}'`;
const rowKey = (id: number) => `web-${id}`;
const values = (r: Row) => [...KEYS.map((k) => r[k] ?? ""), rowKey(r.id)];

let api: sheets_v4.Sheets | null = null;
let ready: Promise<number> | null = null; // resolves to the numeric sheetId (gid) of the tab

function client(): sheets_v4.Sheets {
  if (!api) {
    const credentials = JSON.parse(config.saJson || fs.readFileSync(config.saFile, "utf8"));
    const auth = new google.auth.GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
    api = google.sheets({ version: "v4", auth });
  }
  return api;
}

async function ensure(): Promise<{ s: sheets_v4.Sheets; gid: number }> {
  const s = client();
  ready ??= (async () => {
    const spreadsheetId = config.sheetId;
    const meta = await s.spreadsheets.get({ spreadsheetId });
    let gid = meta.data.sheets?.find((x) => x.properties?.title === config.worksheet)?.properties?.sheetId;
    if (gid == null) {
      const r = await s.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: config.worksheet } } }] },
      });
      gid = r.data.replies?.[0]?.addSheet?.properties?.sheetId ?? 0;
    }
    const hdr = await s.spreadsheets.values.get({ spreadsheetId, range: `${tab()}!A1:${LAST_COL}1` });
    if (JSON.stringify(hdr.data.values?.[0] ?? []) !== JSON.stringify(SHEET_HEADERS)) {
      await s.spreadsheets.values.update({
        spreadsheetId,
        range: `${tab()}!A1`,
        valueInputOption: "RAW",
        requestBody: { values: [SHEET_HEADERS] },
      });
      await s.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            { updateSheetProperties: { properties: { sheetId: gid, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
            { repeatCell: { range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: "userEnteredFormat.textFormat.bold" } },
          ],
        },
      });
    }
    return gid;
  })();
  try {
    return { s, gid: await ready };
  } catch (e) {
    ready = null;
    throw e;
  }
}

function fail(label: string, e: unknown): false {
  api = null;
  ready = null;
  console.error(`Sheets ${label} failed:`, e instanceof Error ? e.message : e);
  return false;
}

async function positions(s: sheets_v4.Sheets): Promise<Map<string, number>> {
  const col = await s.spreadsheets.values.get({ spreadsheetId: config.sheetId, range: `${tab()}!${ID_COL}:${ID_COL}` });
  const pos = new Map<string, number>();
  (col.data.values ?? []).forEach((v, i) => pos.set(String(v[0] ?? ""), i + 1));
  return pos;
}

/** Real-time append. false => rows stay unsynced in SQLite and are retried by sync. */
export async function appendRows(rows: Row[]): Promise<boolean> {
  if (!rows.length || !config.sheetId) return false;
  try {
    const { s } = await ensure();
    await s.spreadsheets.values.append({
      spreadsheetId: config.sheetId,
      range: `${tab()}!A1`,
      valueInputOption: "RAW", // keeps "+966..." as text
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: rows.map(values) },
    });
    return true;
  } catch (e) {
    return fail("append", e);
  }
}

/** Rewrite whole rows (after merges / notes / corrections). Rows missing from the sheet are re-appended. */
export async function updateRows(rows: Row[]): Promise<boolean> {
  if (!rows.length || !config.sheetId) return false;
  try {
    const { s } = await ensure();
    const pos = await positions(s);
    const present = rows.filter((r) => pos.has(rowKey(r.id)));
    const missing = rows.filter((r) => !pos.has(rowKey(r.id)));
    if (present.length) {
      await s.spreadsheets.values.batchUpdate({
        spreadsheetId: config.sheetId,
        requestBody: {
          valueInputOption: "RAW",
          data: present.map((r) => ({ range: `${tab()}!A${pos.get(rowKey(r.id))}:${LAST_COL}`, values: [values(r)] })),
        },
      });
    }
    if (missing.length) return appendRows(missing);
    return true;
  } catch (e) {
    return fail("update", e);
  }
}

export async function deleteRows(ids: number[]): Promise<boolean> {
  if (!ids.length || !config.sheetId) return true;
  try {
    const { s, gid } = await ensure();
    const pos = await positions(s);
    const rowsIdx = ids.map((i) => pos.get(rowKey(i))).filter((x): x is number => !!x).sort((a, b) => b - a); // bottom-up
    if (rowsIdx.length) {
      await s.spreadsheets.batchUpdate({
        spreadsheetId: config.sheetId,
        requestBody: {
          requests: rowsIdx.map((r) => ({ deleteDimension: { range: { sheetId: gid, dimension: "ROWS", startIndex: r - 1, endIndex: r } } })),
        },
      });
    }
    return true;
  } catch (e) {
    return fail("delete", e);
  }
}

/** Test helper: read all data rows of the tab. */
export async function readAll(): Promise<string[][]> {
  const { s } = await ensure();
  const r = await s.spreadsheets.values.get({ spreadsheetId: config.sheetId, range: `${tab()}!A1:${LAST_COL}` });
  return (r.data.values ?? []) as string[][];
}
