"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useGristInit } from "@/lib/grist/hooks";
import type { GristDocAPI } from "@/lib/grist/meta";

/* ══════════════════════════════════════
   CONFIG
══════════════════════════════════════ */
const TABLE_DECOMPTE = "DECOMPTE";
const TABLE_COMMUNES = "Communes";
const TABLE_LOGS     = "DECOMPTE_LOGS";
const TABLE_STATUT   = "Communes_Statut";

const SHOW_SELECTIONS = new Set(["Fixe", "Ciblée", "Rotation"]);

const COM = { Nom: "Nom commune", INSEE: "Code INSEE", ARR: "Arrondissement" };

const DECOMPTE_COLS = {
  Commune: "Commune", Annee: "Annee", Mois: "Mois", Trimestre: "Trimestre",
  Trans_Proro: "Trans_Proro", Retraits_Rejets: "Retraits_Rejets", Refus_Sursis: "Refus_Sursis",
  PD: "PD", CU: "CU", DP: "DP", DP_Division: "DP_Division",
  PC: "PC", Pcm: "Pcm", PA: "PA", Pam: "Pam", Permis_ZA: "Permis_ZA",
  Papier: "Papier",
};

const LOG_COLS = {
  Commune: "Commune", DecompteId: "DecompteId", Type: "Type", Delta: "Delta",
  Timestamp: "Timestamp", CommuneNom: "CommuneNom", Annee: "Annee", Mois: "Mois",
};

const DOC_TYPES: DocType[] = [
  { key: "PD",              code: "PD",            label: "Permis de Démolir",                icon: "fa-hammer",            color: "#8b5cf6", highlight: true },
  { key: "PC",              code: "PC",            label: "Permis de Construire",             icon: "fa-building",          color: "#000091", highlight: true },
  { key: "Pcm",             code: "PCM",           label: "Permis de Construire modificatif", icon: "fa-pen-to-square",     color: "#4338ca", highlight: true },
  { key: "PA",              code: "PA",            label: "Permis d'Aménager",                icon: "fa-map-location-dot",  color: "#0891b2", highlight: true },
  { key: "Pam",             code: "PAM",           label: "Permis d'Aménager modificatif",    icon: "fa-map-pin",           color: "#0e7490", highlight: true },
  { key: "Permis_ZA",       code: "ZA",            label: "Permis Zone Agricole",             icon: "fa-wheat-awn",         color: "#65a30d", highlight: true },
  { key: "DP",              code: "DP",            label: "Déclaration Préalable",            icon: "fa-file-lines",        color: "#3b82f6", hero: true },
  { key: "DP_Division",     code: "DP Div.",       label: "DP Division",                      icon: "fa-scissors",          color: "#0369a1" },
  { key: "Trans_Proro",     code: "Trans/Proro",   label: "Transmissions & Prorogations",     icon: "fa-arrows-rotate",     color: "#6366f1" },
  { key: "Retraits_Rejets", code: "Ret./Rej.",     label: "Retraits & Rejets",                icon: "fa-ban",               color: "#ef4444" },
  { key: "Refus_Sursis",    code: "Ref./Sursis",   label: "Refus & Sursis",                   icon: "fa-circle-xmark",      color: "#f97316" },
  { key: "CU",              code: "CU",            label: "Certificat d'Urbanisme",           icon: "fa-file-circle-check", color: "#14b8a6" },
];

const DEBOUNCE_DELAY_MS   = 250;
const BLUR_DELAY_MS       = 150;
const MAX_COMMUNE_RESULTS = 25;
const MONTHS_FR = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];

/* ══════════════════════════════════════
   TYPES
══════════════════════════════════════ */
type DocType = { key: string; code: string; label: string; icon: string; color: string; hero?: boolean; highlight?: boolean; };
type Commune = { id: number; nom: string; insee: string; arr: string; papier: boolean; };
type DecompteRow = { id: number; annee: number; mois: number; [key: string]: number; };
type DecompteRowAll = DecompteRow & { communeId: number; };
type Statut = { selection: string[]; debut: Date | null; fin: Date | null; };
type LogEntry = { id: number | null; communeId: number; communeNom: string; type: string; delta: number; timestamp: string; annee: number; mois: number; decompteId: number | null; };
type Toast = { id: string; kind: "success" | "error" | "info" | "warning"; title: string; desc?: string; closing?: boolean; };
type VueType = "mois" | "trimestre" | "annee";
type TabType = "saisie" | "dashboard";
type DashScope = "commune" | "all";
type DashSubTab = "croise" | "chart";

/* ══════════════════════════════════════
   HELPERS PURES
══════════════════════════════════════ */
function norm(s: string): string {
  return (s ?? "").toString().toLowerCase()
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}
function pickCol(tableObj: Record<string, unknown>, candidates: string[]): string | null {
  const keys = Object.keys(tableObj);
  for (const c of candidates) if (keys.includes(c)) return c;
  const normMap = new Map(keys.map(k => [norm(k), k]));
  for (const c of candidates) { const hit = normMap.get(norm(c)); if (hit) return hit; }
  return null;
}
function parseDate(v: unknown): Date | null {
  if (!v) return null;
  if (typeof v === "number") return new Date(v * 1000);
  const d = new Date(v as string);
  return isNaN(d.getTime()) ? null : d;
}
function cleanSelection(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter(x => x !== "L" && x != null && x !== "").map(x => x.toString().trim()).filter(Boolean);
  const s = (v ?? "").toString().trim();
  return s ? [s] : [];
}
function moisLabel(m: number, a: number): string { return `${MONTHS_FR[(m || 1) - 1]} ${a}`; }
function isoNow(): string { return new Date().toISOString(); }
function formatTime(iso: string): string {
  if (!iso) return "";
  try { return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); } catch { return iso; }
}
function trimestreLabel(tr: string): string {
  const m = tr.match(/^(\d{4})-T(\d)$/);
  return m ? `T${m[2]} ${m[1]}` : tr;
}
function statutKey(communeId: number, trimestre: string): string { return `${communeId}|${trimestre}`; }
function getCounters(row: DecompteRow | null): Record<string, number> {
  if (!row) return Object.fromEntries(DOC_TYPES.map(dt => [dt.key, 0]));
  return Object.fromEntries(DOC_TYPES.map(dt => [dt.key, row[dt.key] || 0]));
}
function totalCounters(counters: Record<string, number>): number {
  return DOC_TYPES.reduce((s, dt) => s + (counters[dt.key] || 0), 0);
}
function aggregateRows(rows: DecompteRow[]): Record<string, number> {
  const out = Object.fromEntries(DOC_TYPES.map(dt => [dt.key, 0]));
  rows.forEach(row => { DOC_TYPES.forEach(dt => { out[dt.key] += row[dt.key] || 0; }); });
  return out;
}
function debounce<T extends (...args: never[]) => void>(fn: T, delay: number): T {
  let t: ReturnType<typeof setTimeout> | null = null;
  return ((...args: Parameters<T>) => { if (t) clearTimeout(t); t = setTimeout(() => fn(...args), delay); }) as T;
}

/* ══════════════════════════════════════
   COMPOSANT PRINCIPAL
══════════════════════════════════════ */
export default function DecomptePage() {
  const { docApi, gristUser } = useGristInit({ requiredAccess: "full" });
  const docApiRef = useRef<GristDocAPI | null>(null);

  // ── State ──
  const [communes,      setCommunes]      = useState<Commune[]>([]);
  const [communesById,  setCommunesById]  = useState<Map<number, Commune>>(new Map());
  const [statutsByKey,  setStatutsByKey]  = useState<Map<string, Statut>>(new Map());
  const [selected,      setSelected]      = useState<Commune | null>(null);
  const [tab,           setTab]           = useState<TabType>("saisie");
  const [saisieMonth,   setSaisieMonth]   = useState(() => new Date().getMonth() + 1);
  const [saisieYear,    setSaisieYear]    = useState(() => new Date().getFullYear());
  const [decompteRows,  setDecompteRows]  = useState<DecompteRow[]>([]);
  const [allRows,       setAllRows]       = useState<DecompteRowAll[]>([]);
  const [createdByNameMap, setCreatedByNameMap] = useState<Map<number, string>>(new Map());
  const [vue,           setVue]           = useState<VueType>("mois");
  const [dashMonth,     setDashMonth]     = useState(() => new Date().getMonth() + 1);
  const [dashYear,      setDashYear]      = useState(() => new Date().getFullYear());
  const [dashScope,     setDashScope]     = useState<DashScope>("all");
  const [dashSubTab,    setDashSubTab]    = useState<DashSubTab>("croise");
  const [dashSort,      setDashSort]      = useState<"alpha" | "total">("alpha");
  const [dashArr,       setDashArr]       = useState<Set<string>>(new Set());
  const [logs,          setLogs]          = useState<LogEntry[]>([]);
  const [logCount,      setLogCount]      = useState(0);
  const [sidebarOpen,   setSidebarOpen]   = useState(false);
  const [toasts,        setToasts]        = useState<Toast[]>([]);
  const [communeQuery,  setCommuneQuery]  = useState("");
  const [ddOpen,        setDdOpen]        = useState(false);
  const [ddItems,       setDdItems]       = useState<Commune[]>([]);
  const [pulseTile,     setPulseTile]     = useState<string | null>(null);
  const [flashTile,     setFlashTile]     = useState<string | null>(null);
  const [loading,       setLoading]       = useState(true);
  const [paperMode,     setPaperMode]     = useState(false);

  // Refs for async callbacks (avoid stale closures)
  const busyRef          = useRef(false);
  const paperModeRef     = useRef(false);
  const saisieMonthRef   = useRef(saisieMonth);
  const saisieYearRef    = useRef(saisieYear);
  const selectedRef      = useRef<Commune | null>(null);
  const decompteRowsRef  = useRef<DecompteRow[]>([]);
  const allRowsRef           = useRef<DecompteRowAll[]>([]);
  const createdByNameMapRef  = useRef<Map<number, string>>(new Map());
  const communesByIdRef  = useRef<Map<number, Commune>>(new Map());
  const communesRef      = useRef<Commune[]>([]);
  const logsRef          = useRef<LogEntry[]>([]);
  const logCountRef      = useRef(0);

  // Keep refs in sync
  useEffect(() => { docApiRef.current = docApi; }, [docApi]);
  useEffect(() => { saisieMonthRef.current = saisieMonth; }, [saisieMonth]);
  useEffect(() => { saisieYearRef.current = saisieYear; }, [saisieYear]);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => { decompteRowsRef.current = decompteRows; }, [decompteRows]);
  useEffect(() => { allRowsRef.current = allRows; }, [allRows]);
  useEffect(() => { createdByNameMapRef.current = createdByNameMap; }, [createdByNameMap]);
  useEffect(() => { communesByIdRef.current = communesById; }, [communesById]);
  useEffect(() => { communesRef.current = communes; }, [communes]);
  useEffect(() => { logsRef.current = logs; }, [logs]);
  useEffect(() => { logCountRef.current = logCount; }, [logCount]);
  useEffect(() => { paperModeRef.current = paperMode; }, [paperMode]);

  const now = new Date();
  const nowMois = now.getMonth() + 1;
  const nowAnnee = now.getFullYear();
  function nowTrimestre() { return `${nowAnnee}-T${Math.floor(now.getMonth() / 3) + 1}`; }

  /* ── Toast ── */
  let toastCounter = 0;
  const showToast = useCallback((kind: Toast["kind"], title: string, desc?: string, duration = 4000) => {
    const id = `toast-${Date.now()}-${++toastCounter}`;
    setToasts(prev => [...prev, { id, kind, title, desc }]);
    if (kind !== "error" && duration > 0) {
      setTimeout(() => closeToast(id), duration);
    }
    return id;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeToast = useCallback((id: string) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, closing: true } : t));
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 300);
  }, []);

  /* ── Helpers statuts ── */
  function getStatutSelection(communeId: number, trimestre: string, dateStr: string, statMap: Map<string, Statut>): string[] {
    if (!communeId || !trimestre) return [];
    const statut = statMap.get(statutKey(communeId, trimestre));
    if (!statut) return [];
    if (statut.debut || statut.fin) {
      const d = parseDate(dateStr);
      if (!d) return [];
      if (statut.debut && d < statut.debut) return [];
      if (statut.fin   && d > statut.fin)   return [];
    }
    return statut.selection || [];
  }

  function getStatutForPeriod(communeId: number, annee: number, mois: number, statMap: Map<string, Statut>): string[] {
    const trimestre = `${annee}-T${Math.floor((mois - 1) / 3) + 1}`;
    const dateRef   = `${annee}-${String(mois).padStart(2, "0")}-15`;
    return getStatutSelection(communeId, trimestre, dateRef, statMap);
  }

  /* ── Période saisie ── */
  function isEditablePeriod(m: number, a: number): boolean {
    if (a === nowAnnee && m === nowMois) return true;
    if (a === nowAnnee && m === nowMois - 1) return true;
    if (nowMois === 1 && a === nowAnnee - 1 && m === 12) return true;
    return false;
  }

  /* ── Chargement données ── */
  async function loadCommunes(api: GristDocAPI) {
    const tbl = await api.fetchTable(TABLE_COMMUNES);
    const colNom    = pickCol(tbl, [COM.Nom, "Nom_commune", "Nom"]);
    const colInsee  = pickCol(tbl, [COM.INSEE, "Code_INSEE", "INSEE"]);
    const colArr    = pickCol(tbl, [COM.ARR, "Arrondissement"]);
    const colPapier = pickCol(tbl, ["Papier", "papier"]);
    if (!colNom) { showToast("error", "Configuration", "Colonne 'Nom commune' introuvable dans la table Communes."); return; }
    const ids     = (tbl.id as number[]) || [];
    const noms    = (colNom    ? (tbl[colNom]    as string[])  : []) || [];
    const insees  = (colInsee  ? (tbl[colInsee]  as string[])  : []) || [];
    const arrs    = (colArr    ? (tbl[colArr]    as string[])  : []) || [];
    const papiers = (colPapier ? (tbl[colPapier] as unknown[]) : []) || [];
    const communesList: Commune[] = [];
    const byId = new Map<number, Commune>();
    ids.forEach((id, i) => {
      const papier = colPapier ? Boolean(papiers[i]) : false;
      const c: Commune = { id, nom: (noms[i] ?? "").toString().trim(), insee: (insees[i] ?? "").toString().trim(), arr: (arrs[i] ?? "").toString().trim(), papier };
      if (c.nom) { communesList.push(c); byId.set(id, c); }
    });
    communesList.sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
    setCommunes(communesList);
    setCommunesById(byId);
    communesByIdRef.current = byId;
  }

  async function loadStatuts(api: GristDocAPI) {
    try {
      const tbl = await api.fetchTable(TABLE_STATUT);
      const colCommune = pickCol(tbl, ["Commune", "Communes", "CommuneRef"]);
      const colTrim    = pickCol(tbl, ["Trimestre", "Trimestre_acte"]);
      const colSel     = pickCol(tbl, ["Selection", "Sélection", "Sélection ?", "Selection ?"]);
      const colDebut   = pickCol(tbl, ["Debut", "Début", "Date_debut", "Date_début"]);
      const colFin     = pickCol(tbl, ["Fin", "Date_fin"]);
      if (!colCommune || !colTrim || !colSel) return;
      const ids = (tbl.id as number[]) || [];
      const map = new Map<string, Statut>();
      ids.forEach((_, i) => {
        const communeRaw = (tbl[colCommune] as unknown[])[i];
        const communeId  = Array.isArray(communeRaw) ? communeRaw[1] : parseInt(communeRaw as string, 10);
        const trimestre  = ((tbl[colTrim] as unknown[])[i] ?? "").toString().trim();
        const selection  = cleanSelection((tbl[colSel] as unknown[])[i]);
        if (!communeId || isNaN(communeId as number) || !trimestre || !selection.length) return;
        map.set(statutKey(communeId as number, trimestre), {
          selection,
          debut: colDebut ? parseDate((tbl[colDebut] as unknown[])[i]) : null,
          fin:   colFin   ? parseDate((tbl[colFin]   as unknown[])[i]) : null,
        });
      });
      setStatutsByKey(map);
    } catch { /* silencieux */ }
  }

  async function loadAllDecompte(api: GristDocAPI) {
    const tbl = await api.fetchTable(TABLE_DECOMPTE);
    const ids           = (tbl.id as number[]) || [];
    const communes      = (tbl[DECOMPTE_COLS.Commune] as unknown[]) || [];
    const annees        = (tbl[DECOMPTE_COLS.Annee]   as unknown[]) || [];
    const moisArr       = (tbl[DECOMPTE_COLS.Mois]    as unknown[]) || [];
    const createdByArr  = (tbl["CreatedByName"] as (string | null)[]) || [];
    const newCreatedByMap = new Map<number, string>();
    const rows: DecompteRowAll[] = [];
    ids.forEach((id, i) => {
      const cid = communes[i];
      const communeId = parseInt(Array.isArray(cid) ? cid[1] : cid as string, 10);
      if (!communeId || isNaN(communeId)) return;
      const row: DecompteRowAll = { id, communeId, annee: parseInt((annees[i] ?? 0) as string, 10), mois: parseInt((moisArr[i] ?? 0) as string, 10) };
      DOC_TYPES.forEach(dt => { row[dt.key] = parseInt(((tbl[dt.key] as unknown[])?.[i] ?? 0) as string, 10) || 0; });
      row[DECOMPTE_COLS.Papier] = parseInt(((tbl[DECOMPTE_COLS.Papier] as unknown[])?.[i] ?? 0) as string, 10) || 0;
      newCreatedByMap.set(id, String(createdByArr[i] || ""));
      rows.push(row);
    });
    setAllRows(rows);
    allRowsRef.current = rows;
    setCreatedByNameMap(newCreatedByMap);
    createdByNameMapRef.current = newCreatedByMap;
  }

  async function loadAllLogs(api: GristDocAPI) {
    try {
      const tbl = await api.fetchTable(TABLE_LOGS);
      const ids     = (tbl.id as number[]) || [];
      const comms   = (tbl[LOG_COLS.Commune]    as unknown[]) || [];
      const types   = (tbl[LOG_COLS.Type]       as unknown[]) || [];
      const deltas  = (tbl[LOG_COLS.Delta]      as unknown[]) || [];
      const times   = (tbl[LOG_COLS.Timestamp]  as unknown[]) || [];
      const annees  = (tbl[LOG_COLS.Annee]      as unknown[]) || [];
      const moisArr = (tbl[LOG_COLS.Mois]       as unknown[]) || [];
      const decIds  = (tbl[LOG_COLS.DecompteId] as unknown[]) || [];
      const comNoms = (tbl[LOG_COLS.CommuneNom] as unknown[]) || [];
      const entries: LogEntry[] = [];
      ids.forEach((id, i) => {
        const cid = comms[i];
        const communeRefId = Array.isArray(cid) ? cid[1] : cid;
        entries.push({
          id, communeId: communeRefId as number,
          communeNom: (comNoms[i] ?? "").toString(),
          type: (types[i] ?? "").toString(),
          delta: parseInt((deltas[i] ?? 0) as string, 10),
          timestamp: (times[i] ?? "").toString(),
          annee: parseInt((annees[i] ?? 0) as string, 10),
          mois:  parseInt((moisArr[i] ?? 0) as string, 10),
          decompteId: Array.isArray(decIds[i]) ? decIds[i][1] : decIds[i] as number,
        });
      });
      entries.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
      const today = new Date().toISOString().slice(0, 10);
      const count = entries.filter(l => l.timestamp.startsWith(today)).length;
      setLogs(entries);
      logsRef.current = entries;
      setLogCount(count);
      logCountRef.current = count;
    } catch { /* silencieux */ }
  }

  async function loadDecompteForCommune(communeId: number, api: GristDocAPI): Promise<DecompteRow[]> {
    const tbl = await api.fetchTable(TABLE_DECOMPTE);
    const ids      = (tbl.id as number[]) || [];
    const communes = (tbl[DECOMPTE_COLS.Commune] as unknown[]) || [];
    const annees   = (tbl[DECOMPTE_COLS.Annee]   as unknown[]) || [];
    const moisArr  = (tbl[DECOMPTE_COLS.Mois]    as unknown[]) || [];
    const rows: DecompteRow[] = [];
    ids.forEach((id, i) => {
      const cid  = communes[i];
      const cRef = Array.isArray(cid) ? cid[1] : cid;
      if (parseInt(cRef as string, 10) !== communeId) return;
      const row: DecompteRow = { id, annee: parseInt((annees[i] ?? 0) as string, 10), mois: parseInt((moisArr[i] ?? 0) as string, 10) };
      DOC_TYPES.forEach(dt => { row[dt.key] = parseInt(((tbl[dt.key] as unknown[])?.[i] ?? 0) as string, 10) || 0; });
      row[DECOMPTE_COLS.Papier] = parseInt(((tbl[DECOMPTE_COLS.Papier] as unknown[])?.[i] ?? 0) as string, 10) || 0;
      rows.push(row);
    });
    return rows;
  }

  /* ── Init ── */
  useEffect(() => {
    if (!docApi) return;
    docApiRef.current = docApi;
    (async () => {
      try {
        await Promise.all([
          loadCommunes(docApi),
          loadStatuts(docApi),
          loadAllLogs(docApi),
          loadAllDecompte(docApi),
        ]);
      } catch (e: unknown) {
        showToast("error", "Erreur d'initialisation", (e as Error)?.message || String(e));
      } finally {
        setLoading(false);
      }
      // Grist onRecord binding
      const grist = typeof window !== "undefined" ? (window as any).grist : null;
      if (grist && typeof grist.onRecord === "function") {
        grist.onRecord((record: Record<string, unknown>) => {
          if (!record) return;
          let communeId = record[DECOMPTE_COLS.Commune];
          if (Array.isArray(communeId)) communeId = communeId[1];
          communeId = parseInt(communeId as string, 10);
          if (!communeId || isNaN(communeId as number)) return;
          const commune = communesByIdRef.current.get(communeId as number);
          if (!commune) return;
          if (selectedRef.current?.id === communeId) return;
          handleSelectCommune(commune);
        });
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docApi]);

  /* ── Commune search ── */
  function filterCommunes(q: string): Commune[] {
    const nq = norm(q);
    const isNum = /^\d{3,}$/.test(q.trim());
    return communesRef.current.map(c => {
      const nn = norm(c.nom); const ni = norm(c.insee); let score = 0;
      if (isNum) { if (ni === nq) score=100; else if (ni.startsWith(nq)) score=80; else if (ni.includes(nq)) score=50; else return null; }
      else        { if (nn === nq) score=100; else if (nn.startsWith(nq)) score=80; else if (nn.includes(nq)) score=50; else return null; }
      return { c, score };
    }).filter(Boolean).sort((a, b) => b!.score - a!.score || a!.c.nom.localeCompare(b!.c.nom, "fr")).slice(0, MAX_COMMUNE_RESULTS).map(x => x!.c);
  }

  const debouncedSearch = useRef(debounce((q: string) => {
    const results = filterCommunes(q);
    setDdItems(results);
    setDdOpen(results.length > 0 || q.length > 0);
  }, DEBOUNCE_DELAY_MS)).current;

  function handleCommuneInput(q: string) {
    setCommuneQuery(q);
    debouncedSearch(q);
  }

  async function handleSelectCommune(commune: Commune) {
    setSelected(commune);
    selectedRef.current = commune;
    setCommuneQuery(commune.nom);
    setDdOpen(false);
    setLoading(true);
    try {
      if (docApiRef.current) {
        const rows = await loadDecompteForCommune(commune.id, docApiRef.current);
        setDecompteRows(rows);
        decompteRowsRef.current = rows;
      }
    } catch (e: unknown) {
      showToast("error", "Erreur", (e as Error)?.message || "Impossible de charger les données.");
    } finally {
      setLoading(false);
    }
  }

  function handleClearCommune() {
    setSelected(null);
    selectedRef.current = null;
    setCommuneQuery("");
    setDdOpen(false);
    setDecompteRows([]);
    decompteRowsRef.current = [];
    setDashScope("all");
  }

  /* ── Navigation ── */
  function navigateSaisieMois(delta: number) {
    setSaisieMonth(m => { let nm = m + delta; let ny = saisieYearRef.current; if (nm > 12) { nm = 1; ny++; } if (nm < 1) { nm = 12; ny--; } saisieYearRef.current = ny; setSaisieYear(ny); return nm; });
  }

  function navigateDashPeriod(delta: number) {
    setDashMonth(m => {
      let nm = m; let ny = dashYear;
      if (vue === "mois") { nm = m + delta; if (nm > 12) { nm = 1; ny++; } if (nm < 1) { nm = 12; ny--; } }
      else if (vue === "trimestre") { let t = Math.floor((m - 1) / 3) + 1 + delta; if (t > 4) { t = 1; ny++; } if (t < 1) { t = 4; ny--; } nm = (t - 1) * 3 + 1; }
      else { ny = dashYear + delta; }
      setDashYear(ny);
      return nm;
    });
  }

  function isDashAtCurrentPeriod(): boolean {
    if (vue === "mois")      return dashYear === nowAnnee && dashMonth === nowMois;
    if (vue === "trimestre") { const tCurrent = Math.floor((nowMois - 1) / 3) + 1; const tDash = Math.floor((dashMonth - 1) / 3) + 1; return dashYear === nowAnnee && tDash === tCurrent; }
    return dashYear === nowAnnee;
  }

  function dashPeriodLabel(): string {
    if (vue === "mois")      return moisLabel(dashMonth, dashYear);
    if (vue === "trimestre") return trimestreLabel(`${dashYear}-T${Math.floor((dashMonth - 1) / 3) + 1}`);
    return `Année ${dashYear}`;
  }

  /* ── Increment ── */
  const increment = useCallback(async (docKey: string, delta: number = 1) => {
    const commune = selectedRef.current;
    if (!commune || busyRef.current) return;
    const api = docApiRef.current;
    if (!api) return;
    const m = saisieMonthRef.current;
    const a = saisieYearRef.current;

    if (!isEditablePeriod(m, a)) {
      showToast("warning", "Période non modifiable", `${moisLabel(m, a)} est en lecture seule.`, 4000);
      return;
    }
    busyRef.current = true;
    const trimestre = `${a}-T${Math.floor((m - 1) / 3) + 1}`;
    try {
      let rows = [...decompteRowsRef.current];
      let row = rows.find(r => r.annee === a && r.mois === m) || null;
      if (!row) {
        const newFields: Record<string, unknown> = { [DECOMPTE_COLS.Commune]: commune.id, [DECOMPTE_COLS.Annee]: a, [DECOMPTE_COLS.Mois]: m, [DECOMPTE_COLS.Trimestre]: trimestre };
        DOC_TYPES.forEach(dt => { newFields[dt.key] = 0; });
        newFields[DECOMPTE_COLS.Papier] = 0;
        const res = await api.applyUserActions([["AddRecord", TABLE_DECOMPTE, null, newFields]]);
        const rowId = res?.retValues?.[0] ?? null;
        row = { id: rowId, annee: a, mois: m, ...Object.fromEntries(DOC_TYPES.map(dt => [dt.key, 0])), [DECOMPTE_COLS.Papier]: 0 };
        rows = [...rows, row];
        setDecompteRows(rows);
        decompteRowsRef.current = rows;
        // allRows
        setAllRows(prev => { const next = [...prev, { ...row!, communeId: commune.id }]; allRowsRef.current = next; return next; });
      }
      const oldVal = row[docKey] || 0;
      const newVal = Math.max(0, oldVal + delta);
      await api.applyUserActions([["UpdateRecord", TABLE_DECOMPTE, row.id, { [docKey]: newVal }]]);
      // Update state
      const updatedRows = rows.map(r => r.id === row!.id ? { ...r, [docKey]: newVal } : r);
      setDecompteRows(updatedRows);
      decompteRowsRef.current = updatedRows;
      setAllRows(prev => { const next = prev.map(r => r.id === row!.id ? { ...r, [docKey]: newVal } : r); allRowsRef.current = next; return next; });
      // Mode Papier : incrémenter aussi le compteur Papier
      if (paperModeRef.current && delta > 0 && docKey !== DECOMPTE_COLS.Papier) {
        const papierOld = decompteRowsRef.current.find(r => r.id === row!.id)?.[DECOMPTE_COLS.Papier] || 0;
        const papierNew = papierOld + 1;
        await api.applyUserActions([["UpdateRecord", TABLE_DECOMPTE, row!.id, { [DECOMPTE_COLS.Papier]: papierNew }]]);
        const rowsP = decompteRowsRef.current.map(r => r.id === row!.id ? { ...r, [DECOMPTE_COLS.Papier]: papierNew } : r);
        setDecompteRows(rowsP);
        decompteRowsRef.current = rowsP;
        setAllRows(prev => { const next = prev.map(r => r.id === row!.id ? { ...r, [DECOMPTE_COLS.Papier]: papierNew } : r); allRowsRef.current = next; return next; });
      }
      // Log
      const logFields = { [LOG_COLS.Commune]: commune.id, [LOG_COLS.DecompteId]: row.id, [LOG_COLS.Type]: docKey, [LOG_COLS.Delta]: delta, [LOG_COLS.Timestamp]: isoNow(), [LOG_COLS.CommuneNom]: commune.nom, [LOG_COLS.Annee]: a, [LOG_COLS.Mois]: m };
      const logRes = await api.applyUserActions([["AddRecord", TABLE_LOGS, null, logFields]]);
      const logId = logRes?.retValues?.[0] ?? null;
      const logEntry: LogEntry = { id: logId, communeId: commune.id, communeNom: commune.nom, type: docKey, delta, timestamp: logFields[LOG_COLS.Timestamp] as string, annee: a, mois: m, decompteId: row.id };
      setLogs(prev => { const next = [logEntry, ...prev]; logsRef.current = next; return next; });
      const newCount = logCountRef.current + 1;
      setLogCount(newCount);
      logCountRef.current = newCount;
      // Animations
      setPulseTile(docKey);
      setFlashTile(docKey);
      setTimeout(() => setPulseTile(null), 420);
      setTimeout(() => setFlashTile(null), 650);
      // Toast
      const dt = DOC_TYPES.find(d => d.key === docKey);
      const label = dt ? dt.code : docKey;
      if (delta > 0) showToast("success", `+1 ${label}`, `${commune.nom} · ${moisLabel(m, a)}`, 2500);
      else           showToast("info",    `-1 ${label}`, `${commune.nom} · ${moisLabel(m, a)}`, 2500);
    } catch (e: unknown) {
      showToast("error", "Erreur d'enregistrement", (e as Error)?.message || "Veuillez réessayer.");
    } finally {
      busyRef.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function rollbackLog(logEntry: LogEntry) {
    if (busyRef.current) return;
    const savedMonth = saisieMonthRef.current;
    const savedYear  = saisieYearRef.current;
    saisieMonthRef.current = logEntry.mois;
    saisieYearRef.current  = logEntry.annee;
    setSaisieMonth(logEntry.mois);
    setSaisieYear(logEntry.annee);
    await increment(logEntry.type, -logEntry.delta);
    saisieMonthRef.current = savedMonth;
    saisieYearRef.current  = savedYear;
    setSaisieMonth(savedMonth);
    setSaisieYear(savedYear);
  }

  /* ══════════════════════════════════════
     RENDU HELPERS
  ══════════════════════════════════════ */
  function StatutChips({ sel, small }: { sel: string[], small?: boolean }) {
    const visible = sel.filter(s => SHOW_SELECTIONS.has(s));
    if (!visible.length) return null;
    return <>{visible.map(s => {
      const cls = s === "Fixe" ? "fixe" : s === "Ciblée" ? "ciblee" : "rotation";
      return <span key={s} className={`statut-chip statut-chip--${cls}${small ? " statut-chip--sm" : ""}`}>{s}</span>;
    })}</>;
  }

  function NumCell({ v, hl }: { v: number; hl?: boolean }) {
    return <td className={`col-num${v === 0 ? " zero" : ""}${hl ? " col-highlight" : ""}`}>{v}</td>;
  }

  /* ── Saisie Tab ── */
  function SaisieTab() {
    const editable  = isEditablePeriod(saisieMonth, saisieYear);
    const isCurrent = saisieMonth === nowMois && saisieYear === nowAnnee;
    const isPrev    = !isCurrent && editable;
    const row = decompteRows.find(r => r.annee === saisieYear && r.mois === saisieMonth) || null;
    const counters = getCounters(row);
    const total    = totalCounters(counters);
    const papierCount = row?.[DECOMPTE_COLS.Papier] || 0;
    const heroType   = DOC_TYPES.find(dt => dt.hero);
    const otherTypes = DOC_TYPES.filter(dt => !dt.hero);

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {/* Barre période */}
        <div className="saisie-period-bar">
          <button className="saisie-period-bar__nav" onClick={() => navigateSaisieMois(-1)} type="button" aria-label="Mois précédent">
            <i className="fa-solid fa-chevron-left" />
          </button>
          <span className="saisie-period-bar__label">{moisLabel(saisieMonth, saisieYear)}</span>
          <button className="saisie-period-bar__nav" onClick={() => navigateSaisieMois(+1)} disabled={isCurrent} type="button" aria-label="Mois suivant">
            <i className="fa-solid fa-chevron-right" />
          </button>
          {isCurrent && <span className="period-badge period-badge--current">en cours</span>}
          {isPrev    && <span className="period-badge period-badge--prev">mois précédent</span>}
          {!isCurrent && !isPrev && <span className="period-badge period-badge--readonly"><i className="fa-solid fa-lock" style={{ fontSize: ".65rem" }} /> lecture seule</span>}
          {selected && editable && (
            <button
              type="button"
              className={`papier-mode-btn${paperMode ? " active" : ""}`}
              onClick={() => setPaperMode(p => !p)}
              title={paperMode ? "Désactiver le mode Papier" : "Activer le mode Papier — chaque acte ajouté sera aussi comptabilisé en Papier"}
            >
              <i className={`fa-solid ${paperMode ? "fa-file-circle-check" : "fa-file"}`} />
              {paperMode ? "Papier ON" : "Papier"}
            </button>
          )}
          {selected && papierCount > 0 && (
            <span className="saisie-papier-count" title={`${papierCount} acte(s) sur papier ce mois`}>
              <i className="fa-solid fa-file" /> {papierCount}
            </span>
          )}
          {selected && <span className="saisie-period-bar__total">Total : <strong>{total}</strong></span>}
        </div>

        {!selected ? (
          <div className="no-commune">
            <i className="fa-solid fa-magnifying-glass-location" aria-hidden="true" />
            <h2>Sélectionnez une commune</h2>
            <p>Tapez le nom ou le code INSEE pour commencer à décompter.</p>
          </div>
        ) : (
          <>
            {!editable && (
              <div className="tiles-readonly-notice">
                <i className="fa-solid fa-circle-info" />
                <span><strong>{moisLabel(saisieMonth, saisieYear)}</strong> est en lecture seule. Seuls le mois courant et le mois précédent sont modifiables.</span>
              </div>
            )}
            {paperMode && editable && (
              <div className="papier-mode-banner">
                <i className="fa-solid fa-file-circle-check" />
                <span>Mode Papier activé — chaque acte ajouté sera comptabilisé en Papier</span>
                <button type="button" className="papier-mode-banner__close" onClick={() => setPaperMode(false)} aria-label="Désactiver">
                  <i className="fa-solid fa-xmark" />
                </button>
              </div>
            )}
            {heroType && (
              <div className="tile-hero-zone">
                <TileCard dt={heroType} counters={counters} editable={editable} extraClass="tile--hero" />
              </div>
            )}
            <div className="tiles-section-label">Autres actes</div>
            <div className="tiles-grid tiles-grid--secondary">
              {otherTypes.map(dt => <TileCard key={dt.key} dt={dt} counters={counters} editable={editable} />)}
            </div>
          </>
        )}
      </div>
    );
  }

  function TileCard({ dt, counters, editable, extraClass = "" }: { dt: DocType; counters: Record<string, number>; editable: boolean; extraClass?: string; }) {
    const count = counters[dt.key] || 0;
    const isPulsing = pulseTile === dt.key;
    const isFlashing = flashTile === dt.key;
    return (
      <div
        className={`tile${extraClass ? " " + extraClass : ""}${!editable ? " tile--readonly" : ""}${isPulsing ? " tile--pulse" : ""}`}
        role="group" aria-label={dt.label}
        onClick={() => editable && increment(dt.key, 1)}
      >
        <div className="tile__code" style={{ color: dt.color }}>{dt.code}</div>
        <div className="tile__label">{dt.label}</div>
        <div className={`tile__counter${isFlashing ? " just-updated" : ""}`} aria-live="polite" aria-atomic="true">{count}</div>
        <div className="tile__actions">
          <button className="tile__btn tile__btn--minus" type="button" aria-label={`Retirer 1 ${dt.code}`}
            disabled={!editable || count <= 0}
            onClick={e => { e.stopPropagation(); increment(dt.key, -1); }}>
            <i className="fa-solid fa-minus" />
          </button>
          <button className="tile__btn tile__btn--plus" type="button" aria-label={`Ajouter 1 ${dt.code}`}
            disabled={!editable}
            onClick={e => { e.stopPropagation(); increment(dt.key, 1); }}>
            <i className="fa-solid fa-plus" />
          </button>
        </div>
      </div>
    );
  }

  /* ── Dashboard Tab ── */
  function DashboardTab() {
    const atCurrent = isDashAtCurrentPeriod();
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {/* Toolbar */}
        <div className="dashboard-toolbar">
          <span className="dashboard-toolbar__period"><i className="fa-solid fa-calendar" style={{ color: "#000091", marginRight: ".3rem" }} />Période :</span>
          <div className="vue-selector" role="group" aria-label="Granularité">
            {(["mois","trimestre","annee"] as VueType[]).map(v => (
              <button key={v} className={`vue-btn${vue === v ? " active" : ""}`} type="button"
                onClick={() => { setVue(v); setDashMonth(nowMois); setDashYear(nowAnnee); }}>
                {v === "mois" ? "Mois" : v === "trimestre" ? "Trim." : "Année"}
              </button>
            ))}
          </div>
          <div className="dash-nav">
            <button className="dash-nav-btn" type="button" aria-label="Période précédente" onClick={() => navigateDashPeriod(-1)}>
              <i className="fa-solid fa-chevron-left" />
            </button>
            <span className="dash-period-label">{dashPeriodLabel()}</span>
            <button className="dash-nav-btn" type="button" aria-label="Période suivante" disabled={atCurrent} onClick={() => navigateDashPeriod(+1)}>
              <i className="fa-solid fa-chevron-right" />
            </button>
          </div>
          <div className="scope-bar">
            <button className={`scope-btn${dashScope === "commune" ? " active" : ""}`} type="button" onClick={() => setDashScope("commune")}>
              <i className="fa-solid fa-location-dot" />{selected ? selected.nom : "Commune sélectionnée"}
            </button>
            <button className={`scope-btn${dashScope === "all" ? " active" : ""}`} type="button" onClick={() => setDashScope("all")}>
              <i className="fa-solid fa-earth-europe" />Toutes les communes
            </button>
          </div>
        </div>
        {dashScope === "commune" ? <DashCommune /> : <DashAll />}
      </div>
    );
  }

  function DashCommune() {
    if (!selected) return (
      <div className="no-commune">
        <i className="fa-solid fa-magnifying-glass-location" />
        <h2>Sélectionnez une commune</h2>
        <p>Tapez le nom dans la barre ci-dessus pour afficher ses données.</p>
      </div>
    );
    const a = dashYear; const m = dashMonth;
    const colHeaders = DOC_TYPES.map(dt => <th key={dt.key} className={`col-num${dt.highlight ? " col-highlight" : ""}`}>{dt.code}</th>);

    if (vue === "mois") {
      const row = decompteRows.find(r => r.annee === a && r.mois === m);
      const counters = getCounters(row || null);
      const total = totalCounters(counters);
      const isCurrent = a === nowAnnee && m === nowMois;
      const statut = getStatutForPeriod(selected.id, a, m, statutsByKey);
      return (
        <div className="hist-section">
          <div className="hist-section__header">
            <i className="fa-solid fa-table" />{moisLabel(m, a)} — {selected.nom}<StatutChips sel={statut} />
            <span style={{ marginLeft: "auto", fontWeight: 400, color: "#555" }}>Total : <strong style={{ color: "#000091" }}>{total}</strong></span>
          </div>
          <div className="recap-table-wrap">
            <table className="recap-table">
              <thead><tr><th>Période</th>{colHeaders}<th className="col-num col-total">Total</th><th>Saisi par</th></tr></thead>
              <tbody>
                <tr>
                  <td><strong>{moisLabel(m, a)}</strong>{isCurrent && <span style={{ color: "#000091", fontSize: ".65rem" }}> ◀ en cours</span>}</td>
                  {DOC_TYPES.map(dt => <NumCell key={dt.key} v={counters[dt.key] || 0} hl={dt.highlight} />)}
                  <td className="col-num col-total">{total || <span style={{ color: "#ccc" }}>0</span>}</td>
                  <td className="col-created">{row ? (createdByNameMap.get(row.id) || "—") : "—"}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    type RowData = { label: string; counters: Record<string, number>; isCurrent: boolean; isTotal?: boolean; statut: string[]; };
    let rows: RowData[] = [];
    let title = "";
    let headerStatut: string[] = [];

    if (vue === "trimestre") {
      const t = Math.floor((m - 1) / 3) + 1;
      const mStart = (t - 1) * 3 + 1;
      const moisDuTrim = [mStart, mStart+1, mStart+2].filter(mm => mm <= 12);
      title = trimestreLabel(`${a}-T${t}`);
      headerStatut = getStatutForPeriod(selected.id, a, mStart, statutsByKey);
      const tableRows: RowData[] = moisDuTrim.map(mm => ({
        label: MONTHS_FR[mm-1], counters: getCounters(decompteRows.find(r => r.annee === a && r.mois === mm) || null),
        isCurrent: a === nowAnnee && mm === nowMois, statut: getStatutForPeriod(selected.id, a, mm, statutsByKey),
      }));
      const totals = aggregateRows(moisDuTrim.map(mm => decompteRows.find(r => r.annee === a && r.mois === mm)).filter(Boolean) as DecompteRow[]);
      rows = [...tableRows, { label: "TOTAL", counters: totals, isCurrent: false, isTotal: true, statut: [] }];
    } else {
      title = `Année ${a}`;
      const trimRows: RowData[] = [1,2,3,4].map(t => {
        const mStart = (t-1)*3+1; const mEnd = t*3;
        const matching = decompteRows.filter(r => r.annee === a && r.mois >= mStart && r.mois <= mEnd);
        return { label: `T${t} ${a}`, counters: aggregateRows(matching), isCurrent: a === nowAnnee && t === Math.floor((nowMois-1)/3)+1, statut: getStatutForPeriod(selected.id, a, mStart, statutsByKey) };
      });
      const totals = aggregateRows(decompteRows.filter(r => r.annee === a));
      rows = [...trimRows, { label: "TOTAL ANNUEL", counters: totals, isCurrent: false, isTotal: true, statut: [] }];
    }

    return (
      <div className="hist-section">
        <div className="hist-section__header">
          <i className="fa-solid fa-table" />Vue {title} — {selected.nom}<StatutChips sel={headerStatut} />
        </div>
        <div className="recap-table-wrap">
          <table className="recap-table">
            <thead><tr><th>Période</th>{colHeaders}<th className="col-num col-total">Total</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={r.isTotal ? "total-row" : ""}>
                  <td>
                    <strong>{r.label}</strong>
                    {r.isCurrent && !r.isTotal && <span style={{ color: "#000091", fontSize: ".65rem" }}> ◀ en cours</span>}
                    {!r.isTotal && <StatutChips sel={r.statut} />}
                  </td>
                  {DOC_TYPES.map(dt => <NumCell key={dt.key} v={r.counters[dt.key] || 0} hl={dt.highlight} />)}
                  <td className="col-num col-total">{totalCounters(r.counters) || <span style={{ color: "#ccc" }}>0</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function getRowsForPeriod(rows: DecompteRowAll[]): DecompteRowAll[] {
    const a = dashYear; const m = dashMonth;
    if (vue === "mois") return rows.filter(r => r.annee === a && r.mois === m);
    if (vue === "trimestre") { const t = Math.floor((m-1)/3)+1; const mStart=(t-1)*3+1; const mEnd=t*3; return rows.filter(r => r.annee===a && r.mois>=mStart && r.mois<=mEnd); }
    return rows.filter(r => r.annee === a);
  }

  type CommuneAgg = { id: number; nom: string; counters: Record<string, number>; total: number; createdByName?: string; statut?: string[]; statutsAnnee?: { t: number; sels: string[] }[]; };

  function buildCommuneList(): CommuneAgg[] {
    const rows = getRowsForPeriod(allRows);
    const byCommune = new Map<number, CommuneAgg>();
    rows.forEach(row => {
      const commune = communesById.get(row.communeId);
      if (!commune) return;
      if (!byCommune.has(row.communeId)) byCommune.set(row.communeId, { id: row.communeId, nom: commune.nom, counters: Object.fromEntries(DOC_TYPES.map(dt => [dt.key, 0])), total: 0 });
      const entry = byCommune.get(row.communeId)!;
      DOC_TYPES.forEach(dt => { entry.counters[dt.key] += row[dt.key] || 0; });
      // Garde le nom du créateur (premier trouvé pour cette commune sur la période)
      if (!entry.createdByName) entry.createdByName = createdByNameMapRef.current.get(row.id) || "";
    });
    const da = dashYear; const dm = dashMonth;
    byCommune.forEach((entry, communeId) => {
      if (vue === "annee") {
        entry.statutsAnnee = [1,2,3,4].map(t => ({ t, sels: getStatutForPeriod(communeId, da, (t-1)*3+1, statutsByKey) })).filter(x => x.sels.length);
      } else {
        entry.statut = getStatutForPeriod(communeId, da, dm, statutsByKey);
      }
      entry.total = totalCounters(entry.counters);
    });
    return Array.from(byCommune.values()).sort((a, b) => dashSort === "alpha" ? a.nom.localeCompare(b.nom, "fr") : b.total - a.total);
  }

  function DashAll() {
    const allCommuneList = buildCommuneList();
    const ARR_ORDER = ["Toulouse", "Muret", "Saint-Gaudens"];
    const availableArrs = new Set(communes.map(c => c.arr).filter(Boolean));
    const allArrs = ARR_ORDER.filter(a => availableArrs.has(a));
    const communeList = dashArr.size > 0 ? allCommuneList.filter(c => dashArr.has(communesById.get(c.id)?.arr ?? "")) : allCommuneList;
    if (allCommuneList.length === 0) return <div className="chart-empty">Aucune donnée pour cette période.</div>;
    return (
      <div style={{ background: "#fff", border: "1px solid #ddd", borderRadius: ".5rem", overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,.05)" }}>
        {allArrs.length > 1 && (
          <div className="arr-filter-bar">
            <button className={`arr-filter-btn${dashArr.size === 0 ? " active" : ""}`} type="button" onClick={() => setDashArr(new Set())}>Tous</button>
            {allArrs.map(arr => (
              <button key={arr} className={`arr-filter-btn${dashArr.has(arr) ? " active" : ""}`} type="button" onClick={() => setDashArr(prev => { const next = new Set(prev); if (next.has(arr)) { next.delete(arr); } else { next.add(arr); } return next; })}>{arr}</button>
            ))}
          </div>
        )}
        <div className="sub-tabs">
          {([["croise","fa-table","Tableau"],["chart","fa-chart-bar","Graphique"]] as const).map(([key, icon, label]) => (
            <button key={key} className={`sub-tab${dashSubTab === key ? " active" : ""}`} type="button" onClick={() => setDashSubTab(key)}>
              <i className={`fa-solid ${icon}`} />{label}
            </button>
          ))}
          <button className="sort-toggle-btn" type="button" onClick={() => setDashSort(s => s === "alpha" ? "total" : "alpha")}>
            <i className={`fa-solid ${dashSort === "alpha" ? "fa-arrow-down-9-1" : "fa-arrow-down-a-z"}`} />
            {dashSort === "alpha" ? "Par total" : "A→Z"}
          </button>
        </div>
        <div style={{ padding: ".75rem 1rem 1rem" }}>
          {dashSubTab === "croise" && <CroiseTable communeList={communeList} />}
          {dashSubTab === "chart"  && <ChartSvg    communeList={communeList} />}
        </div>
      </div>
    );
  }

  function CroiseTable({ communeList }: { communeList: CommuneAgg[] }) {
    // Colonnes visibles : au moins une commune avec une valeur > 0
    const visibleTypes = DOC_TYPES.filter(dt => communeList.some(c => (c.counters[dt.key] || 0) > 0));

    const totals = Object.fromEntries(DOC_TYPES.map(dt => [dt.key, 0]));
    communeList.forEach(c => DOC_TYPES.forEach(dt => { totals[dt.key] += c.counters[dt.key]; }));
    const grandTotal = communeList.reduce((s, c) => s + c.total, 0);

    // Totaux par tag (seulement si au moins une commune avec ce tag)
    const TAG_DEFS = [
      { tag: "Fixe",     cls: "tag-total-row--fixe"     },
      { tag: "Rotation", cls: "tag-total-row--rotation" },
      { tag: "Ciblée",   cls: "tag-total-row--ciblee"   },
    ];
    const tagTotals = TAG_DEFS.map(({ tag, cls }) => {
      const filtered = communeList.filter(c => {
        const sels = vue === "annee" && c.statutsAnnee?.length ? c.statutsAnnee[0].sels : (c.statut || []);
        return sels.some(s => s === tag);
      });
      if (filtered.length === 0) return null;
      const counters = Object.fromEntries(DOC_TYPES.map(dt => [dt.key, 0]));
      filtered.forEach(c => DOC_TYPES.forEach(dt => { counters[dt.key] += c.counters[dt.key]; }));
      const total = filtered.reduce((s, c) => s + c.total, 0);
      return { tag, cls, counters, total };
    }).filter(Boolean);

    // Total combiné Fixe+Rotation+Ciblée
    const combinedFiltered = communeList.filter(c => {
      const sels = vue === "annee" && c.statutsAnnee?.length ? c.statutsAnnee[0].sels : (c.statut || []);
      return sels.some(s => s === "Fixe" || s === "Rotation" || s === "Ciblée");
    });
    const combinedCounters = Object.fromEntries(DOC_TYPES.map(dt => [dt.key, 0]));
    combinedFiltered.forEach(c => DOC_TYPES.forEach(dt => { combinedCounters[dt.key] += c.counters[dt.key]; }));
    const combinedTotal = combinedFiltered.reduce((s, c) => s + c.total, 0);

    // Total sans Fixe+Rotation+Ciblée
    const noTagFiltered = communeList.filter(c => {
      const sels = vue === "annee" && c.statutsAnnee?.length ? c.statutsAnnee[0].sels : (c.statut || []);
      return !sels.some(s => s === "Fixe" || s === "Rotation" || s === "Ciblée");
    });
    const noTagCounters = Object.fromEntries(DOC_TYPES.map(dt => [dt.key, 0]));
    noTagFiltered.forEach(c => DOC_TYPES.forEach(dt => { noTagCounters[dt.key] += c.counters[dt.key]; }));
    const noTagTotal = noTagFiltered.reduce((s, c) => s + c.total, 0);

    // Total Papier
    const papierFiltered = communeList.filter(c => communesById.get(c.id)?.papier === true);
    const papierCounters = Object.fromEntries(DOC_TYPES.map(dt => [dt.key, 0]));
    papierFiltered.forEach(c => DOC_TYPES.forEach(dt => { papierCounters[dt.key] += c.counters[dt.key]; }));
    const papierTotal = papierFiltered.reduce((s, c) => s + c.total, 0);

    return (
      <div className="croise-wrap">
        <table className="croise-table">
          <thead><tr><th>Commune</th><th className="col-arr">Arr.</th>{visibleTypes.map(dt => <th key={dt.key} className={`col-num${dt.highlight ? " col-highlight" : ""}`} title={dt.label}>{dt.code}</th>)}<th className="col-num col-total">Total</th><th>Saisi par</th></tr></thead>
          <tbody>
            {communeList.map(c => {
              const statuts = vue === "annee" && c.statutsAnnee?.length ? c.statutsAnnee[0].sels : (c.statut || []);
              const isCiblee = statuts.some(s => s === "Ciblée");
              return (
                <tr key={c.id} className="croise-row-commune" style={{ cursor: "pointer" }} title={`Voir le détail de ${c.nom}`}
                  onClick={() => { const comm = communesById.get(c.id); if (comm) handleSelectCommune(comm); }}>
                  <td>{c.nom}<StatutChips sel={statuts} /></td>
                  <td className="col-arr">{communesById.get(c.id)?.arr || ""}</td>
                  {visibleTypes.map(dt => <NumCell key={dt.key} v={c.counters[dt.key] || 0} hl={dt.highlight || (dt.key === "DP" && isCiblee)} />)}
                  <td className="col-num col-total" style={{ fontWeight: 700 }}>{c.total}</td>
                  <td className="col-created">{c.createdByName || "—"}</td>
                </tr>
              );
            })}
            <tr className="total-row">
              <td><strong>TOTAL</strong></td>
              <td />
              {visibleTypes.map(dt => <NumCell key={dt.key} v={totals[dt.key] || 0} hl={dt.highlight} />)}
              <td className="col-num col-total"><strong>{grandTotal}</strong></td>
              <td />
            </tr>
            {tagTotals.map(tt => (
              <tr key={tt!.tag} className={`tag-total-row ${tt!.cls}`}>
                <td><strong>Total {tt!.tag}</strong></td>
                <td />
                {visibleTypes.map(dt => <NumCell key={dt.key} v={tt!.counters[dt.key] || 0} hl={dt.highlight} />)}
                <td className="col-num col-total"><strong>{tt!.total}</strong></td>
                <td />
              </tr>
            ))}
            {combinedFiltered.length > 0 && (
              <tr className="combined-total-row">
                <td><strong>Total Fixe+Rotation+Ciblée</strong></td>
                <td />
                {visibleTypes.map(dt => <NumCell key={dt.key} v={combinedCounters[dt.key] || 0} hl={dt.highlight} />)}
                <td className="col-num col-total"><strong>{combinedTotal}</strong></td>
                <td />
              </tr>
            )}
            {noTagFiltered.length > 0 && (
              <tr className="no-tag-total-row">
                <td><strong>Total sans Fixe+Rotation+Ciblée</strong></td>
                <td />
                {visibleTypes.map(dt => <NumCell key={dt.key} v={noTagCounters[dt.key] || 0} hl={dt.highlight} />)}
                <td className="col-num col-total"><strong>{noTagTotal}</strong></td>
                <td />
              </tr>
            )}
            {papierFiltered.length > 0 && (
              <tr className="papier-total-row">
                <td><strong>Total Papier</strong></td>
                <td />
                {visibleTypes.map(dt => <NumCell key={dt.key} v={papierCounters[dt.key] || 0} hl={dt.highlight} />)}
                <td className="col-num col-total"><strong>{papierTotal}</strong></td>
                <td />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  }

  function DetailTable({ communeList }: { communeList: CommuneAgg[] }) {
    const groups = new Map<string, { arr: string; communes: CommuneAgg[]; total: number; totalDP: number }>();
    communeList.forEach(c => {
      const arr = communesById.get(c.id)?.arr || "";
      if (!arr) return;
      if (!groups.has(arr)) groups.set(arr, { arr, communes: [], total: 0, totalDP: 0 });
      const g = groups.get(arr)!;
      g.communes.push(c); g.total += c.total; g.totalDP += c.counters["DP"] || 0;
    });
    if (groups.size === 0) return <div className="chart-empty">Aucune donnée avec arrondissement pour cette période.</div>;
    const sorted = Array.from(groups.values()).sort((a, b) => a.arr.localeCompare(b.arr, "fr", { numeric: true }));
    return (
      <div className="arr-group-list">
        {sorted.map(g => (
          <div key={g.arr} className="arr-group">
            <div className="arr-group__header">
              <span className="arr-group__label">{g.arr}</span>
              <span><span className="arr-group__dp-label">DP {g.totalDP}</span></span>
              <span><span className="arr-group__total-label">Total : {g.total}</span></span>
            </div>
            <div className="arr-group__communes">
              {g.communes.map(c => {
                const dpCount = c.counters["DP"] || 0;
                const statuts = vue === "annee" && c.statutsAnnee?.length ? c.statutsAnnee[0].sels : (c.statut || []);
                return (
                  <div key={c.id} className="commune-detail-item" onClick={() => { const comm = communesById.get(c.id); if (comm) handleSelectCommune(comm); }}>
                    <div className="commune-detail-item__name">{c.nom}<StatutChips sel={statuts} /></div>
                    <div className="commune-detail-item__total">{c.total}</div>
                    <div className="commune-detail-item__breakdown">
                      <span className="detail-chip detail-chip--dp">DP {dpCount}</span>
                      {DOC_TYPES.filter(dt => dt.key !== "DP" && (c.counters[dt.key] || 0) > 0).map(dt => (
                        <span key={dt.key} className="detail-chip">{dt.code} {c.counters[dt.key]}</span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  }

  function ChartSvg({ communeList }: { communeList: CommuneAgg[] }) {
    if (communeList.length === 0) return <div className="chart-empty">Aucune donnée.</div>;
    const data = communeList.slice(0, 30);
    const maxVal = Math.max(...data.map(c => c.total), 1);
    const BAR_W=36, BAR_GAP=10, CHART_H=200, LABEL_H=60, LEFT_PAD=32, TOP_PAD=10;
    const totalW = LEFT_PAD + data.length * (BAR_W + BAR_GAP);
    const svgH = CHART_H + LABEL_H + TOP_PAD;
    return (
      <div className="chart-wrap">
        <svg width={totalW} height={svgH} style={{ overflow: "visible", display: "block" }}>
          {[0, 0.25, 0.5, 0.75, 1].map(frac => {
            const y = TOP_PAD + Math.round(CHART_H * (1 - frac));
            return <g key={frac}>
              <line x1={LEFT_PAD-4} y1={y} x2={totalW} y2={y} stroke="#eee" strokeWidth={1} />
              <text x={LEFT_PAD-6} y={y+4} textAnchor="end" fontSize={9} fill="#aaa">{Math.round(maxVal*frac)}</text>
            </g>;
          })}
          {data.map((c, i) => {
            const x = LEFT_PAD + i * (BAR_W + BAR_GAP);
            const barH = Math.max(4, Math.round((c.total / maxVal) * CHART_H));
            const y = TOP_PAD + CHART_H - barH;
            const shortName = c.nom.length > 10 ? c.nom.slice(0, 9) + "…" : c.nom;
            return <g key={c.id}>
              <rect x={x} y={y} width={BAR_W} height={barH} fill="#000091" rx={3} opacity={.85}><title>{c.nom} : {c.total}</title></rect>
              <text x={x + BAR_W/2} y={y-4} textAnchor="middle" fontSize={10} fontWeight={700} fill="#000091">{c.total}</text>
              <text x={x + BAR_W/2} y={TOP_PAD + CHART_H + 14} textAnchor="end" fontSize={9.5} fill="#555" transform={`rotate(-40 ${x + BAR_W/2} ${TOP_PAD + CHART_H + 14})`}>{shortName}</text>
            </g>;
          })}
          <line x1={LEFT_PAD} y1={TOP_PAD} x2={LEFT_PAD} y2={TOP_PAD+CHART_H} stroke="#ccc" strokeWidth={1} />
          <line x1={LEFT_PAD} y1={TOP_PAD+CHART_H} x2={totalW} y2={TOP_PAD+CHART_H} stroke="#ccc" strokeWidth={1} />
        </svg>
        {data.length < communeList.length && <p style={{ fontSize: ".72rem", color: "#888", marginTop: ".5rem" }}>Affichage limité aux 30 communes avec le plus d&apos;actes.</p>}
      </div>
    );
  }

  /* ── Sel Badge ── */
  function getSelBadge(): string[] {
    if (!selected) return [];
    const annee = tab === "dashboard" ? dashYear  : saisieYear;
    const mois  = tab === "dashboard" ? dashMonth : saisieMonth;
    return getStatutForPeriod(selected.id, annee, mois, statutsByKey).filter(s => SHOW_SELECTIONS.has(s));
  }

  /* ══════════════════════════════════════
     RENDER
  ══════════════════════════════════════ */
  return (
    <div className="app-shell">
      {/* Sidebar */}
      <aside className={`sidebar${sidebarOpen ? " open" : ""}`} aria-label="Journal des opérations">
        <div className="sidebar__header">
          <h2><i className="fa-solid fa-clock-rotate-left" />Journal</h2>
          <button className="sidebar__close" type="button" aria-label="Fermer" onClick={() => setSidebarOpen(false)}>
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
        <div className="sidebar__body">
          {logs.length === 0 ? (
            <div className="sidebar__empty">Aucune opération pour le moment.</div>
          ) : logs.map((log, idx) => {
            const dt = DOC_TYPES.find(d => d.key === log.type);
            const label = dt ? dt.code : log.type;
            const sign = log.delta > 0 ? "+" : "-";
            const iconCls = log.delta > 0 ? "log-item__icon--plus" : "log-item__icon--minus";
            return (
              <div key={idx} className="log-item">
                <div className={`log-item__icon ${iconCls}`}>{sign}{Math.abs(log.delta)}</div>
                <div className="log-item__body">
                  <div className="log-item__desc">{label}{log.communeNom && <> — <span style={{ fontWeight: 400, color: "#666" }}>{log.communeNom}</span></>}</div>
                  <div className="log-item__meta">{moisLabel(log.mois, log.annee)} · {formatTime(log.timestamp)}</div>
                </div>
                <button className="log-item__rollback" type="button" title="Annuler" onClick={() => rollbackLog(log)}>
                  <i className="fa-solid fa-rotate-left" /> Annuler
                </button>
              </div>
            );
          })}
        </div>
      </aside>

      {/* Main */}
      <div className={`app-main${sidebarOpen ? " sidebar-open" : ""}`}>
        {/* Header */}
        <header className="app-header">
          <div className="app-header__logo"><i className="fa-solid fa-landmark" />DDT 31</div>
          <div className="app-header__title">Décompte des actes</div>
          <nav className="app-tabs" role="tablist" aria-label="Modes">
            <button className={`app-tab${tab === "saisie" ? " active" : ""}`} data-tab="saisie" role="tab" aria-selected={tab === "saisie"} type="button"
              onClick={() => { setTab("saisie"); handleClearCommune(); }}>
              <i className="fa-solid fa-pen-to-square" />Saisie
            </button>
            <button className={`app-tab${tab === "dashboard" ? " active" : ""}`} data-tab="dashboard" role="tab" aria-selected={tab === "dashboard"} type="button"
              onClick={() => { setTab("dashboard"); handleClearCommune(); }}>
              <i className="fa-solid fa-chart-column" />Tableau de bord
            </button>
          </nav>
          {gristUser && (
            <div className="app-header__user" title={gristUser.email}>
              <i className="fa-solid fa-circle-user" />
              <span>{gristUser.name}</span>
            </div>
          )}
          <button className="btn-log-toggle" type="button" aria-label="Journal" onClick={() => setSidebarOpen(o => !o)}>
            <i className="fa-solid fa-clock-rotate-left" />Journal
            <span className={`log-badge${logCount > 0 ? " visible" : ""}`}>{logCount}</span>
          </button>
        </header>

        {/* Content */}
        <div className="app-content">
          {/* Commune bar */}
          <div className="commune-bar">
            <div className="commune-bar__label"><i className="fa-solid fa-location-dot" />Commune</div>
            <div className="commune-bar__search">
              <div className="commune-input-wrap">
                <input
                  type="text"
                  className="commune-input"
                  placeholder="Rechercher une commune…"
                  autoComplete="off"
                  value={communeQuery}
                  onChange={e => handleCommuneInput(e.target.value)}
                  onFocus={e => { if (e.target.value.length > 0) debouncedSearch(e.target.value); }}
                  onBlur={() => setTimeout(() => setDdOpen(false), BLUR_DELAY_MS)}
                  onKeyDown={e => { if (e.key === "Escape") { setDdOpen(false); } }}
                  aria-label="Rechercher une commune"
                  aria-expanded={ddOpen}
                />
                <button className={`commune-clear-btn${selected || communeQuery ? " visible" : ""}`} type="button" aria-label="Effacer" tabIndex={-1}
                  onClick={handleClearCommune}>
                  <i className="fa-solid fa-xmark" />
                </button>
                <div className={`dd-panel${ddOpen ? " open" : ""}`} role="listbox">
                  {ddItems.length === 0 && communeQuery
                    ? <div className="dd-empty">Aucune commune trouvée</div>
                    : ddItems.map(c => (
                      <div key={c.id} className="dd-option" role="option" tabIndex={0}
                        onMouseDown={e => { e.preventDefault(); handleSelectCommune(c); }}>
                        {c.arr && <span className="dd-option__arr">{c.arr}</span>}
                        <span className="dd-option__name">{c.nom}</span>
                      </div>
                    ))}
                </div>
              </div>
            </div>
            {/* Sel badge */}
            {(() => {
              const sels = getSelBadge();
              return sels.length > 0 ? sels.map(s => {
                const cls = s === "Fixe" ? "sel-badge--fixe" : s === "Ciblée" ? "sel-badge--ciblee" : "sel-badge--rotation";
                return <span key={s} className={`sel-badge ${cls} visible`}>{s}</span>;
              }) : null;
            })()}
            {/* Arr badge */}
            {selected?.arr && <span className="arr-badge visible">{selected.arr}</span>}
          </div>

          {/* Zone principale */}
          {loading ? (
            <div className="loading-spinner">
              <i className="fa-solid fa-spinner fa-spin" />
              Chargement…
            </div>
          ) : tab === "saisie" ? <SaisieTab /> : <DashboardTab />}
        </div>
      </div>

      {/* Toasts */}
      <div className="toast-container" aria-live="polite" aria-atomic="false">
        {toasts.map(t => {
          const iconMap: Record<string, string> = { success: "fa-circle-check", error: "fa-circle-xmark", info: "fa-circle-info", warning: "fa-triangle-exclamation" };
          return (
            <div key={t.id} className={`toast toast--${t.kind}${t.closing ? " toast--closing" : ""}`}>
              <div className="toast__icon"><i className={`fa-solid ${iconMap[t.kind]}`} /></div>
              <div className="toast__content">
                <div className="toast__title">{t.title}</div>
                {t.desc && <div className="toast__message">{t.desc}</div>}
              </div>
              <button className="toast__close" type="button" aria-label="Fermer" onClick={() => closeToast(t.id)}>
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
