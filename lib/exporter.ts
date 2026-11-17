import ExcelJS from "exceljs";
import { sortForTab, summaryMatrix } from "./sheets";
import { allRows } from "./store";
import { MASTER_TAB_DEFAULT, SECTOR_NAMES, SUMMARY_TAB } from "./taxonomy";
import { HEADERS, KEYS, type Row } from "./types";

function fillLeadSheet(wb: ExcelJS.Workbook, title: string, rows: Row[], headerColor = "FF1F4E78") {
  const safeTitle = title.slice(0, 31).replace(/[\[\]:*?/\\]/g, "-");
  const ws = wb.addWorksheet(safeTitle, { views: [{ state: "frozen", ySplit: 1, rightToLeft: true }] });
  ws.addRow(HEADERS);
  for (const r of rows) ws.addRow(KEYS.map((k) => r[k] ?? ""));

  ws.getRow(1).eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: headerColor } };
    c.alignment = { horizontal: "center", vertical: "middle" };
  });
  HEADERS.forEach((h, i) => {
    const longest = Math.max(h.length, ...rows.map((r) => String(r[KEYS[i]] ?? "").length));
    ws.getColumn(i + 1).width = Math.min(longest + 3, 50);
  });
  ws.eachRow((row, n) => {
    if (n === 1) return;
    row.eachCell((c) => {
      c.numFmt = "@";
      c.alignment = { vertical: "top", wrapText: true };
    });
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: HEADERS.length } };
}

export async function buildXlsx(): Promise<Buffer | null> {
  const rows = allRows();
  if (!rows.length) return null;
  const wb = new ExcelJS.Workbook();

  // 1. Master sheet
  fillLeadSheet(wb, MASTER_TAB_DEFAULT, rows, "FF1F4E78");

  // 2. Summary sheet
  const sum = wb.addWorksheet(SUMMARY_TAB, { views: [{ state: "frozen", ySplit: 1, rightToLeft: true }] });
  const matrix = summaryMatrix(rows);
  for (const r of matrix) sum.addRow(r);
  sum.getRow(1).eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF6A1B9A" } };
    c.alignment = { horizontal: "center", vertical: "middle" };
  });
  sum.getRow(matrix.length).eachCell((c) => {
    c.font = { bold: true };
  });
  matrix[0].forEach((h, i) => {
    sum.getColumn(i + 1).width = Math.max(String(h).length + 5, 18);
  });

  // 3. One sheet per active sector, sorted by management hierarchy
  const usedSectors = SECTOR_NAMES.filter((s) => rows.some((r) => r.sector === s));
  for (const s of usedSectors) {
    const sectorRows = sortForTab(rows.filter((r) => r.sector === s));
    fillLeadSheet(wb, s, sectorRows, "FF2E7D32");
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
