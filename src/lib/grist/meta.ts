// src/lib/grist/meta.ts
export type GristDocAPI = {
  fetchTable: (tableId: string) => Promise<any>;
  applyUserActions: (actions: any[]) => Promise<any>;
  /** Mode REST uniquement : retourne l'URL de téléchargement d'une pièce jointe via le proxy n8n. */
  getAttachmentDownloadUrl?: (attachId: number) => string;
  /**
   * Mode REST uniquement : upload un ou plusieurs fichiers via le proxy n8n.
   * Retourne les rowIds des nouvelles pièces jointes dans _grist_Attachments.
   */
  uploadAttachments?: (files: FileList) => Promise<number[]>;
};

export type ColMeta = {
  colId: string;
  label: string;
  type: string;
  widgetOptions: string;
  widgetOptionsParsed: Record<string, any>;
  isFormula: boolean;
  formula: string;
  description?: string;
  visibleColRowId?: number | null;
  displayColRowId?: number | null;
};

export type RefType =
  | { kind: "Ref"; tableId: string }
  | { kind: "RefList"; tableId: string };

export type RefItem = { id: number; label: string; extra: string; q: string };
export type RefCache = {
  tableId: string;
  displayCol: string;
  rows: RefItem[];
  byId: Map<number, RefItem>;
};

export function parseWidgetOptions(str: string): Record<string, any> {
  if (!str) return {};
  try {
    return JSON.parse(str);
  } catch {
    return {};
  }
}

export function parseRefType(typeStr: string): RefType | null {
  const m1 = /^Ref:(.+)$/.exec(typeStr);
  if (m1) return { kind: "Ref", tableId: m1[1] };
  const m2 = /^RefList:(.+)$/.exec(typeStr);
  if (m2) return { kind: "RefList", tableId: m2[1] };
  return null;
}

/** Grist list cell encoding: ["L", ...] */
export function isListCell(v: any): v is any[] {
  return Array.isArray(v) && v[0] === "L";
}
export function decodeListCell(v: any): any[] {
  return isListCell(v) ? v.slice(1) : v == null ? [] : Array.isArray(v) ? v : [v];
}
export function encodeListCell(arr: any[]): any[] {
  return ["L", ...(arr || [])];
}

export function normalizeChoices(raw: any): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((x) => (x == null ? "" : String(x))).filter(Boolean);
  if (typeof raw === "string") return raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return [];
}

/**
 * Charge les métadonnées de colonnes pour une table donnée.
 *
 * Fonctionne en mode plugin Grist ET en mode REST standalone :
 * _grist_Tables et _grist_Tables_column sont accessibles via l'endpoint
 * /records du proxy n8n comme n'importe quelle table.
 *
 * ⚠️  Le tableId passé doit correspondre au Table ID Grist (pas au nom
 *     d'affichage). Vérifiable via Settings → Table ID dans Grist.
 */
export async function loadColumnsMetaFor(docApi: GristDocAPI, tableId: string) {
  const tables = await docApi.fetchTable("_grist_Tables");
  const idx = (tables.tableId as string[]).findIndex((t) => t === tableId);
  if (idx < 0) throw new Error(`Table introuvable: ${tableId}`);
  const parentId = tables.id[idx];

  const cols = await docApi.fetchTable("_grist_Tables_column");
  const res: ColMeta[] = [];
  for (let i = 0; i < cols.id.length; i++) {
    if (cols.parentId[i] !== parentId) continue;
    const colId = cols.colId[i];
    if (!colId) continue;
    const rawOpts = cols.widgetOptions?.[i] || "";
    res.push({
      colId,
      label: cols.label?.[i] || colId,
      type: cols.type?.[i] || "Text",
      widgetOptions: rawOpts,
      widgetOptionsParsed: parseWidgetOptions(rawOpts),
      isFormula: !!cols.isFormula?.[i],
      formula: cols.formula?.[i] || "",
      description: (cols.description ? cols.description[i] || "" : ""),
      visibleColRowId: (cols.visibleCol ? cols.visibleCol[i] : null),
      displayColRowId: (cols.displayCol ? cols.displayCol[i] : null),
    });
  }
  res.sort((a, b) => a.colId.localeCompare(b.colId));
  return res;
}

export function isEditable(col: ColMeta) {
  // "Empty column" dans Grist a isFormula=true mais formula="" → traiter comme donnée éditable.
  // Seules les colonnes avec une vraie formule non vide sont en lecture seule.
  if (col.isFormula && col.formula) return false;
  const ban = new Set(["id", "manualSort", "ManualSort", "CreatedAt", "UpdatedAt"]);
  return !ban.has(col.colId);
}

/**
 * Construit une table rowId -> {colId,...} pour pouvoir résoudre visibleCol/displayCol.
 * (dans ton HTML tu stockes gristColIdByRowId pour ensureRefCache)  [oai_citation:6‡index.html](sediment://file_00000000c8307246a79ff09ceabb26c4)
 */
export async function buildColRowIdMap(docApi: GristDocAPI) {
  const cols = await docApi.fetchTable("_grist_Tables_column");
  const map = new Map<number, { colId: string }>();
  for (let i = 0; i < cols.id.length; i++) {
    const rowId = cols.id[i];
    const colId = cols.colId[i];
    if (rowId != null && colId) map.set(rowId, { colId });
  }
  return map;
}

/**
 * Ref cache (équivalent ensureRefCache de ton HTML)  [oai_citation:7‡index.html](sediment://file_00000000c8307246a79ff09ceabb26c4)
 */
const refsCache = new Map<string, RefCache>();

export async function ensureRefCache(
  docApi: GristDocAPI,
  col: ColMeta,
  gristColIdByRowId: Map<number, { colId: string }>
): Promise<RefCache | null> {
  const parsed = parseRefType(col.type);
  if (!parsed || (parsed.kind !== "Ref" && parsed.kind !== "RefList")) return null;
  if (refsCache.has(col.colId)) return refsCache.get(col.colId)!;

  const t = await docApi.fetchTable(parsed.tableId);
  const colNames = Object.keys(t).filter((k) => k !== "id");

  let displayFromMeta: string | null = null;
  const rowId = col.visibleColRowId || col.displayColRowId;
  if (typeof rowId === "number") {
    const meta = gristColIdByRowId.get(rowId);
    if (meta?.colId) displayFromMeta = meta.colId;
  }

  const wopts = col.widgetOptionsParsed || {};
  const displayFromOptions =
    wopts.visibleCol || wopts.displayCol || wopts.showColumn || wopts.visibleColumn;

  const candidate = displayFromMeta || (displayFromOptions ? String(displayFromOptions) : null);
  const displayCol = candidate && colNames.includes(candidate) ? candidate : colNames[0];

  const rows: RefItem[] = [];
  const byId = new Map<number, RefItem>();

  for (let i = 0; i < t.id.length; i++) {
    const id = t.id[i];
    const label = (t[displayCol]?.[i] ?? `${id}`).toString();
    const extra = "";
    const item = { id, label, extra, q: (label + " " + id).toLowerCase() };
    rows.push(item);
    byId.set(id, item);
  }

  const cache: RefCache = { tableId: parsed.tableId, displayCol, rows, byId };
  refsCache.set(col.colId, cache);
  return cache;
}

/** Date: Grist stocke (souvent) en timestamp Unix secondes.  [oai_citation:8‡index.html](sediment://file_00000000c8307246a79ff09ceabb26c4) */
export function unixSecondsToISODate(v: any): string {
  if (v == null) return "";
  if (typeof v === "number") return new Date(v * 1000).toISOString().slice(0, 10);
  const s = String(v);
  return s.includes("T") ? s.slice(0, 10) : s;
}
export function isoDateToUnixSeconds(iso: string): number | null {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00Z");
  return Math.floor(d.getTime() / 1000);
}