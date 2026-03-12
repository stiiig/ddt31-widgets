import ExcelJS from "exceljs";

export type XlsxRowKind =
  | "commune"
  | "separator"
  | "total"
  | "tag-fixe"
  | "tag-rotation"
  | "tag-ciblee"
  | "combined"
  | "no-tag"
  | "papier"
  | "papier-acts";

export type XlsxRow = {
  kind: XlsxRowKind;
  values: (string | number)[];
};

export type XlsxColMeta = {
  label: string;
  width?: number;
  /** true = colonne "highlight" (PD, PC, PCM, PA, PAM, ZA) */
  highlight?: boolean;
  /** true = colonne Total */
  isTotal?: boolean;
};

/* ──────────────────────────────────────
   Palette (calquée sur styles.css)
────────────────────────────────────── */
const P = {
  white:     "FFFFFFFF",
  headerBg:  "FF000091",
  headerFg:  "FFFFFFFF",
  hlBg:      "FF7C3AED", // en-tête colonnes highlight
  hlFg:      "FFFFFFFF",
  hlCell:    "FFF5F3FF", // cellule highlight (ligne commune)
  hlTotal:   "FFEDE9FE", // cellule highlight (ligne TOTAL)
  totalBg:   "FFF5F5FE",
  totalFg:   "FF000091",
  totalColBg:"FFC5C5E8",
  colTotalBg:"FFE8E8F8",
  colTotalFg:"FF000091",
  fixeBg:    "FFFEF9C3", fixeFg: "FF713F12", fixeHl: "FFFCE47A", fixeTotal: "FFFCE47A",
  rotBg:     "FFFFEDD5", rotFg:  "FF9A3412", rotHl:  "FFFDC995", rotTotal: "FFFDC995",
  cibBg:     "FFFFE4E4", cibFg:  "FFB91C1C", cibHl:  "FFFFA5A5", cibTotal: "FFFFA5A5",
  combBg:    "FFE4E4E4", combFg: "FF222222", combHl: "FFD4D0EA", combTotal:"FFC4C4C4",
  noTagBg:   "FFF0F4F0", noTagFg:"FF2D4A2D", noTagHl:"FFD8E8D8", noTagTotal:"FFC8DCC8",
  papBg:     "FFF5F5FE", papFg:  "FF000091", papHl:  "FFEDE9FE", papTotal: "FFC5C5E8",
  papActsBg: "FFFFF7ED", papActsFg:"FFB34000", papActsTotal:"FFFED7AA",
};

function hex(color: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb: color } };
}

function font(color: string, bold = false): Partial<ExcelJS.Font> {
  return { color: { argb: color }, bold };
}

function applyRow(
  row: ExcelJS.Row,
  bg: string,
  fg: string,
  bold: boolean,
  colMetas: XlsxColMeta[],
  hlBg: string,
  hlFg: string,
  totalBg: string,
  totalFg: string,
) {
  row.eachCell({ includeEmpty: true }, (cell, col) => {
    const meta = colMetas[col - 1];
    if (!meta) return;
    const thisBg = meta.isTotal ? totalBg : meta.highlight ? hlBg : bg;
    const thisFg = meta.isTotal ? totalFg : meta.highlight ? hlFg : fg;
    cell.fill = hex(thisBg);
    cell.font = font(thisFg, bold);
    cell.alignment = { vertical: "middle", horizontal: meta.highlight || meta.isTotal ? "center" : undefined };
  });
}

export async function exportXlsx(
  filename: string,
  colMetas: XlsxColMeta[],
  rows: XlsxRow[],
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Export");

  // Largeurs de colonnes
  ws.columns = colMetas.map(m => ({ width: m.width ?? 12 }));

  // En-tête
  const headerRow = ws.addRow(colMetas.map(m => m.label));
  headerRow.height = 22;
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    const meta = colMetas[col - 1];
    if (!meta) return;
    const bg = meta.highlight ? P.hlBg : meta.isTotal ? P.headerBg : P.headerBg;
    cell.fill = hex(bg);
    cell.font = font(P.headerFg, true);
    cell.alignment = { vertical: "middle", horizontal: meta.highlight || meta.isTotal ? "center" : "left" };
    cell.border = { bottom: { style: "thin", color: { argb: "FFAAAACC" } } };
  });

  // Lignes de données
  for (const row of rows) {
    if (row.kind === "separator") {
      const r = ws.addRow(row.values);
      r.height = 6;
      r.eachCell({ includeEmpty: true }, cell => { cell.fill = hex(P.white); });
      continue;
    }

    const r = ws.addRow(row.values);
    r.height = 18;

    switch (row.kind) {
      case "commune":
        r.eachCell({ includeEmpty: true }, (cell, col) => {
          const meta = colMetas[col - 1];
          if (!meta) return;
          const bg = meta.isTotal ? P.colTotalBg : meta.highlight ? P.hlCell : P.white;
          const fg = meta.isTotal ? P.colTotalFg : "FF111111";
          cell.fill = hex(bg);
          cell.font = font(fg, false);
          cell.alignment = { vertical: "middle", horizontal: meta.highlight || meta.isTotal ? "center" : undefined };
        });
        break;
      case "total":
        applyRow(r, P.totalBg, P.totalFg, true, colMetas, P.hlTotal, P.totalFg, P.totalColBg, P.totalFg);
        break;
      case "tag-fixe":
        applyRow(r, P.fixeBg, P.fixeFg, true, colMetas, P.fixeHl, P.fixeFg, P.fixeTotal, P.fixeFg);
        break;
      case "tag-rotation":
        applyRow(r, P.rotBg, P.rotFg, true, colMetas, P.rotHl, P.rotFg, P.rotTotal, P.rotFg);
        break;
      case "tag-ciblee":
        applyRow(r, P.cibBg, P.cibFg, true, colMetas, P.cibHl, P.cibFg, P.cibTotal, P.cibFg);
        break;
      case "combined":
        applyRow(r, P.combBg, P.combFg, true, colMetas, P.combHl, P.combFg, P.combTotal, P.combFg);
        break;
      case "no-tag":
        applyRow(r, P.noTagBg, P.noTagFg, true, colMetas, P.noTagHl, P.noTagFg, P.noTagTotal, P.noTagFg);
        break;
      case "papier":
        applyRow(r, P.papBg, P.papFg, true, colMetas, P.papHl, P.papFg, P.papTotal, P.papFg);
        break;
      case "papier-acts":
        r.eachCell({ includeEmpty: true }, (cell, col) => {
          const meta = colMetas[col - 1];
          if (!meta) return;
          const bg = meta.isTotal ? P.papActsTotal : P.papActsBg;
          cell.fill = hex(bg);
          cell.font = font(P.papActsFg, true);
          cell.alignment = { vertical: "middle", horizontal: meta.highlight || meta.isTotal ? "center" : undefined };
        });
        break;
    }
  }

  // Freeze la première ligne (en-tête)
  ws.views = [{ state: "frozen", ySplit: 1 }];

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
