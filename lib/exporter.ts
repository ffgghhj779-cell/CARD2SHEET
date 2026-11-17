import ExcelJS from "exceljs";
import { allRows } from "./store";
import { HEADERS, KEYS } from "./types";

export async function buildXlsx(): Promise<Buffer | null> {
  const rows = allRows();
  if (!rows.length) return null;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Leads", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.addRow(HEADERS);
  for (const r of rows) ws.addRow(KEYS.map((k) => r[k] ?? ""));

  ws.getRow(1).eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
    c.alignment = { horizontal: "center", vertical: "middle" };
  });
  HEADERS.forEach((h, i) => {
    const longest = Math.max(h.length, ...rows.map((r) => String(r[KEYS[i]] ?? "").length));
    ws.getColumn(i + 1).width = Math.min(longest + 3, 50);
  });
  ws.eachRow((row, n) => {
    if (n === 1) return;
    row.eachCell((c) => {
      c.numFmt = "@"; // keep phones as text
      c.alignment = { vertical: "top", wrapText: true };
    });
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: HEADERS.length } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
