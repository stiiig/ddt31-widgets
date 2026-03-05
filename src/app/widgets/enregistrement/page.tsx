"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useGristInit } from "@/lib/grist/hooks";

// ═══════════════════════════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════════════════════════

const TABLE_ACTES   = "AN_PC";
const TABLE_COMMUNES = "Communes";
const TABLE_STATUT  = "Communes_Statut";

const DEFAULT_TRIMESTRE = "2026-T1";
const DEFAULT_SELECTION = "Non ciblée";
const SHOW_SELECTIONS   = new Set(["Fixe", "Ciblée", "Rotation"]);
const DEBOUNCE_DELAY_MS = 300;
const MAX_COMMUNE_RESULTS = 25;

const COLS = {
  Type: "Type",
  Type2: "Type2",
  Mois: "Mois",
  Annee: "Annee",
  NoActe: "N_ACTE",
  NParcelle: "N_Parcelle",
  NomProjet: "Nom_du_projet",
  VisaMairie: "Visa_Mairie",
  ReceptionPref: "Reception_Pref",
  Origine: "Origine",
  Enjeux: "Enjeux_pre_identifies",
  MotifsControle: "Motifs_controle",
  EnjeuOld: "O_Concerne_par_l_enjeu",
  EnjeuPrefix: "Enjeu_",
  Controle: "Controle",
  RaisonControle: "P_Raison_du_controle_ou_non_controle",
  MAJCS: "MAJCS",
  Trimestre: "Trimestre",
  SelectionSnapshot: "Selection_commune_au_moment",
  CommuneRef: "Communes",
  TailleLogements: "Taille_logements",
} as const;

const ALL_MOTIFS = ["ZI", "RT", "ZA", "ZN", "STEP", "PEB", "Site classé"] as const;
const ALL_OBJETS = ["ERP 1/2/3", "ERP 4/5", "EE", "LLS", "Signalé", "Aléatoire", "Taille"] as const;

const OBJET_TO_COL: Record<string, string> = {
  "ERP 1/2/3": "ERP123", "ERP 4/5": "ERP45", "EE": "EE",
  "LLS": "LLS", "Signalé": "Signale", "Aléatoire": "Aleatoire", "Taille": "Taille",
};
const MOTIF_TO_COL: Record<string, string> = { "Site classé": "Classe" };

const COMMUNE_ENJEUX_MAP: Record<string, string> = { STEP: "STEP", RT: "RT", PEB: "PEB", LLS: "LLS" };

const TYPE_LABELS: Record<string, string> = {
  PC: "Permis de construire", PA: "Permis d'aménager",
  PD: "Permis de démolir",   DP: "Déclaration préalable",
};
const TYPE2_LABELS: Record<string, string> = {
  I: "Permis initial", M: "Permis modificatif",
  T: "Transfert de permis", P: "Prorogation du permis",
};

const TYPE2_DEFAULT  = "I";
const ORIGINE_DEFAULT = "@CTES";

const COM = {
  Nom: "Nom commune", INSEE: "Code INSEE", ARR: "Arrondissement",
  LOG: "Logements", ENJEUX: "Enjeux", HORS_ZI: "Hors_ZI",
};

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

interface Commune {
  id: number;
  nom: string;
  insee: string;
  arr: string;
  logementsFmt: string;
  reglementation: string;
  enjeux: string[];
  horsZI: boolean;
  nameNorm: string;
  inseeNorm: string;
  display: string;
  metaSelected: string;
}

interface Statut {
  selection: string[];
  debut: Date | null;
  fin: Date | null;
}

interface AnpcRow {
  id: number;
  majcs: string;
  communeId: number | null;
  communeName: string;
  arr: string;
  logements: string;
  nActe: string;
  nomProjet: string;
  type: string;
  type2: string;
  motif: unknown;
  objet: unknown;
  visaMairie: Date | null;
  receptionPref: Date | null;
  createdByName: string;
}

interface DashFilters {
  arr: string[];
  motif: string[];
  objet: string[];
  selection: string[];
  reglementation: string[];
}

interface Toast {
  id: number;
  kind: "success" | "error" | "warning" | "info";
  title: string;
  message: string;
}

// ═══════════════════════════════════════════════════════════
// UTILITAIRES PURS
// ═══════════════════════════════════════════════════════════

function norm(s: unknown): string {
  return (s ?? "").toString().toLowerCase()
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function pickCol(tableObj: Record<string, unknown[]>, candidates: string[]): string | null {
  const keys = Object.keys(tableObj);
  for (const c of candidates) if (keys.includes(c)) return c;
  const normMap = new Map(keys.map(k => [norm(k), k]));
  for (const c of candidates) { const hit = normMap.get(norm(c)); if (hit) return hit; }
  return null;
}

function cleanStr(v: unknown): string {
  return (v ?? "").toString().trim()
    .replace(/^\s*[\[,]/, "").replace(/[\],]\s*$/, "").trim();
}

function joinDots(parts: (string | undefined | null)[]): string {
  return parts.map(cleanStr).filter(Boolean).join(" • ");
}

function toGristList(arr: string[]): unknown {
  const a = arr.map(x => x.trim()).filter(Boolean);
  return a.length ? ["L", ...a] : null;
}

function fromGristList(v: unknown): string[] {
  if (Array.isArray(v)) return (v[0] === "L" ? v.slice(1) : v).map(x => (x ?? "").toString()).filter(Boolean);
  return (v || "").toString().split(/[;,]\s*/).filter(Boolean);
}

function parseDate(v: unknown): Date | null {
  if (!v) return null;
  if (typeof v === "number") { const d = new Date(v * 1000); return isNaN(d.getTime()) ? null : d; }
  if (typeof v !== "string") return null;
  let d = new Date(v);
  if (!isNaN(d.getTime())) return d;
  const parts = v.split("/");
  if (parts.length === 3) {
    const [day, month, year] = parts.map(Number);
    d = new Date(year, month - 1, day);
    if (!isNaN(d.getTime())) return d;
  }
  const asNum = parseFloat(v);
  if (!isNaN(asNum) && asNum > 0) { d = new Date(asNum * 1000); if (!isNaN(d.getTime())) return d; }
  return null;
}

function computeTrimestreFromDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-T${Math.floor(d.getMonth() / 3) + 1}`;
}

function statutKey(communeId: number, trimestre: string): string {
  return `${communeId}|${trimestre}`;
}

function getStatutSelection(
  statutsByKey: Map<string, Statut>,
  communeId: number | null,
  trimestre: string,
  dateStr?: string,
): string[] {
  if (!communeId || !trimestre) return [];
  const statut = statutsByKey.get(statutKey(communeId, trimestre));
  if (!statut) return [];
  if (statut.debut || statut.fin) {
    const d = parseDate(dateStr);
    if (!d) return [];
    if (statut.debut && d < statut.debut) return [];
    if (statut.fin && d > statut.fin) return [];
  }
  return statut.selection || [];
}

function cleanSelection(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) {
    if (v.length >= 2 && v[0] === "L") return v.slice(1).map(x => String(x).trim()).filter(Boolean);
    return [];
  }
  let s = String(v).trim().replace(/^L,\s*/i, "").replace(/\s*,\s*/g, ", ").replace(/,\s*$/g, "");
  return s.split(/[;,]/).map(x => x.trim()).filter(Boolean);
}

function formatLogements(v: unknown): string {
  const s = cleanStr(v);
  if (!s) return "";
  const match = s.match(/^(\d+)/);
  if (match) return `${match[1]}+`;
  return s;
}

function enjeuColForItem(item: string): string {
  if ((ALL_MOTIFS as readonly string[]).includes(item)) {
    const colName = MOTIF_TO_COL[item] || item;
    return `${COLS.EnjeuPrefix}${colName}`;
  }
  if ((ALL_OBJETS as readonly string[]).includes(item)) {
    const colName = OBJET_TO_COL[item] || item;
    return `${COLS.EnjeuPrefix}${colName}`;
  }
  return `${COLS.EnjeuPrefix}${item}`;
}

function getSeuilLogements(commune: Commune): number {
  const arr = (commune.arr || "").trim();
  const nom = (commune.nom || "").trim().toLowerCase();
  if (arr === "Toulouse") return nom === "toulouse" ? 100 : 75;
  if (arr === "Muret") return 20;
  if (arr === "Saint-Gaudens") return 10;
  return 75;
}

function enjeuId(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function scoreCommune(c: Commune, q: string, qNorm: string): number {
  const insee = c.inseeNorm || "";
  const nameN = c.nameNorm || "";
  const qDigits = q.replace(/\D+/g, "");
  const isInseeQuery = qDigits.length >= 2 && qDigits.length <= 5 && qDigits === q.trim();
  if (isInseeQuery) {
    if (insee === qDigits) return 0;
    if (insee.startsWith(qDigits)) return 1;
    if (nameN.startsWith(qNorm)) return 2;
    if (nameN.includes(qNorm)) return 3;
    if (insee.includes(qDigits)) return 4;
    return 99;
  } else {
    if (nameN === qNorm) return 0;
    if (nameN.startsWith(qNorm)) return 1;
    if (nameN.includes(qNorm)) return 2;
    if (insee.startsWith(qDigits)) return 3;
    if (insee.includes(qDigits)) return 4;
    return 99;
  }
}

function filterCommunesFromList(communes: Commune[], q: string): Commune[] {
  const raw = q.trim();
  if (!raw) return [];
  const qNorm = norm(raw);
  const scored: [number, Commune][] = [];
  for (const c of communes) {
    const sc = scoreCommune(c, raw, qNorm);
    if (sc !== 99) scored.push([sc, c]);
  }
  scored.sort((a, b) => a[0] !== b[0] ? a[0] - b[0] : a[1].nom.localeCompare(b[1].nom, "fr"));
  return scored.slice(0, MAX_COMMUNE_RESULTS).map(x => x[1]);
}

function normalizeCommuneId(
  v: unknown,
  communesByNom: Map<string, Commune>,
  communesByInsee: Map<string, Commune>,
): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (Array.isArray(v)) {
    const a0 = v[0];
    if (typeof a0 === "number") return a0;
    if (typeof a0 === "string") return normalizeCommuneId(a0, communesByNom, communesByInsee);
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    const byName = communesByNom.get(s);
    if (byName) return byName.id;
    const byInsee = communesByInsee.get(s);
    if (byInsee) return byInsee.id;
    const sl = s.toLowerCase();
    for (const [nom, cc] of communesByNom.entries()) {
      if (String(nom).toLowerCase() === sl) return cc.id;
    }
    for (const [insee, cc] of communesByInsee.entries()) {
      if (String(insee).toLowerCase() === sl) return cc.id;
    }
  }
  return null;
}

function selectionHasAny(selections: string[], wanted: string[]): boolean {
  return selections.some(s => wanted.some(w => s.toLowerCase().includes(w.toLowerCase())));
}

function isNonEmptyChoiceList(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 1;
  return fromGristList(v).length > 0;
}

function debounce<T extends unknown[]>(fn: (...args: T) => void, delay: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: T) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function getDashPeriodLabel(dashVue: string, dashMonth: number, dashYear: number): string {
  const months = ["Jan", "Fév", "Mar", "Avr", "Mai", "Jun", "Jul", "Aoû", "Sep", "Oct", "Nov", "Déc"];
  if (dashVue === "mois") return `${months[dashMonth - 1]} ${dashYear}`;
  if (dashVue === "trimestre") return `T${Math.floor((dashMonth - 1) / 3) + 1} ${dashYear}`;
  return `${dashYear}`;
}

// ═══════════════════════════════════════════════════════════
// COMPOSANTS UI RÉUTILISABLES
// ═══════════════════════════════════════════════════════════

interface TypeDropdownProps {
  value: string;
  choices: string[];
  labels?: Record<string, string>;
  placeholder?: string;
  onChange: (v: string) => void;
  hasError?: boolean;
}

function TypeDropdown({ value, choices, labels = {}, placeholder = "—", onChange, hasError }: TypeDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  return (
    <div className="type-dd" ref={ref}>
      <button
        type="button"
        className="type-dd__btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-invalid={hasError ? "true" : undefined}
        onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
      >
        <span className={`type-dd__label ${value ? "" : "type-dd__label--placeholder"}`}>
          {value ? (labels[value] || value) : placeholder}
        </span>
        <svg className="type-dd__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="type-dd__panel is-open" role="listbox">
          {choices.length === 0
            ? <div className="type-dd__empty">Aucun choix disponible</div>
            : choices.map(choice => (
              <button
                key={choice}
                type="button"
                className={`type-dd__item ${value === choice ? "is-selected" : ""}`}
                onClick={() => { onChange(choice); setOpen(false); }}
              >
                <span className="type-dd__item-badge">{choice}</span>
                {labels[choice] || choice}
              </button>
            ))
          }
        </div>
      )}
    </div>
  );
}

interface MotifItemProps {
  itemKey: string;
  kind: "motif" | "objet";
  checked: boolean;
  enjeuValue: "Oui" | "Non" | null;
  onCheck: (checked: boolean) => void;
  onEnjeu: (v: "Oui" | "Non") => void;
  hasError?: boolean;
  children?: React.ReactNode;
}

function MotifItem({ itemKey, kind, checked, enjeuValue, onCheck, onEnjeu, hasError, children }: MotifItemProps) {
  const idKey = enjeuId(itemKey);
  const isIndolore = itemKey === "ERP 4/5" || itemKey === "Taille";
  const inputId = `${kind}-${idKey}`;

  return (
    <div className={`motif-item${checked ? " is-checked" : ""}${hasError ? " has-error" : ""}`} data-motif={kind === "motif" ? itemKey : undefined} data-objet={kind === "objet" ? itemKey : undefined}>
      <div className="motif-item__checkbox">
        <input type="checkbox" id={inputId} className={kind} value={itemKey} checked={checked}
          onChange={e => onCheck(e.target.checked)} />
      </div>
      {children ? (
        <div className="motif-item__content">
          {children}
        </div>
      ) : (
        <label className="fr-label motif-item__label motif-item__label--badge" htmlFor={inputId}>
          <span className={`motif-badge${itemKey.length > 5 ? " motif-badge--sm" : ""}`}>{itemKey}</span>
        </label>
      )}
      {checked && !isIndolore && (
        <div className="motif-item__radios">
          {(["Non", "Oui"] as const).map(val => (
            <label
              key={val}
              className={`motif-radio${enjeuValue === val ? (val === "Oui" ? " is-oui" : " is-non") : ""}`}
              htmlFor={`enjeu-${idKey}-${val.toLowerCase()}`}
            >
              <input
                type="radio"
                id={`enjeu-${idKey}-${val.toLowerCase()}`}
                name={`enjeu_${itemKey}`}
                value={val}
                checked={enjeuValue === val}
                onChange={() => onEnjeu(val)}
              />
              {val}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

interface ToastContainerProps { toasts: Toast[]; onClose: (id: number) => void; }

function ToastContainer({ toasts, onClose }: ToastContainerProps) {
  const iconMap: Record<string, string> = {
    success: "fa-circle-check", error: "fa-circle-xmark",
    warning: "fa-triangle-exclamation", info: "fa-circle-info",
  };
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast--${t.kind}`} role="alert">
          <div className="toast__icon"><i className={`fa-solid ${iconMap[t.kind]}`} aria-hidden="true" /></div>
          <div className="toast__content">
            <div className="toast__title">{t.title}</div>
            {t.message && <div className="toast__message" dangerouslySetInnerHTML={{ __html: t.message.replace(/\n/g, "<br>") }} />}
          </div>
          <button type="button" className="toast__close" onClick={() => onClose(t.id)} aria-label="Fermer">
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// COMPOSANT PRINCIPAL
// ═══════════════════════════════════════════════════════════

let toastCounter = 0;

export default function EnregistrementPage() {
  const { docApi, gristUser } = useGristInit({ requiredAccess: "full" });

  // — Mode & form —
  const [mode, setModeState] = useState<"create" | "edit">("create");
  const [currentRowId, setCurrentRowId] = useState<number | null>(null);
  const [currentRecord, setCurrentRecord] = useState<Record<string, unknown> | null>(null);

  // — Tab —
  const [tab, setTab] = useState<"saisie" | "dashboard">("saisie");

  // — Communes —
  const [communes, setCommunes] = useState<Commune[]>([]);
  const communesRef       = useRef<Commune[]>([]);
  const communesByIdRef   = useRef<Map<number, Commune>>(new Map());
  const communesByNomRef  = useRef<Map<string, Commune>>(new Map());
  const communesByInseeRef = useRef<Map<string, Commune>>(new Map());

  // — Statuts —
  const [statutsByKey, setStatutsByKey] = useState<Map<string, Statut>>(new Map());
  const statutsByKeyRef = useRef<Map<string, Statut>>(new Map());
  const [statutsStatus, setStatutsStatus] = useState<string>("unknown");
  const statutsStatusRef = useRef<string>("unknown");

  // — Choices —
  const [typeChoices, setTypeChoices] = useState<string[]>([]);
  const [type2Choices, setType2Choices] = useState<string[]>([]);
  const [origineChoices, setOrigineChoices] = useState<string[]>([]);

  // — Form values —
  const [formType, setFormType] = useState("");
  const [formType2, setFormType2] = useState(TYPE2_DEFAULT);
  const [formOrigine, setFormOrigine] = useState(ORIGINE_DEFAULT);
  const [formNoActe, setFormNoActe] = useState("");
  const [formNParcelle, setFormNParcelle] = useState("");
  const [formNomProjet, setFormNomProjet] = useState("");
  const [formVisaMairie, setFormVisaMairie] = useState("");
  const [formReceptionPref, setFormReceptionPref] = useState("");

  // — Enjeux —
  const [selectedMotifs, setSelectedMotifs] = useState<string[]>([]);
  const [selectedObjets, setSelectedObjets] = useState<string[]>([]);
  const [enjeuValues, setEnjeuValues] = useState<Record<string, "Oui" | "Non">>({});
  const [tailleLogements, setTailleLogements] = useState<string>("");

  // — Commune sélectionnée —
  const [selectedCommune, setSelectedCommune] = useState<Commune | null>(null);
  const selectedCommuneRef = useRef<Commune | null>(null);
  const [communeAutoChecked, setCommuneAutoChecked] = useState<Set<string>>(new Set());
  const communeAutoCheckedRef = useRef<Set<string>>(new Set());

  // — Commune search (form) —
  const [communeQuery, setCommuneQuery] = useState("");
  const [communeDdItems, setCommuneDdItems] = useState<Commune[]>([]);
  const [communeDdOpen, setCommuneDdOpen] = useState(false);

  // — Environment —
  const [actesColSet, setActesColSet] = useState<Set<string>>(new Set());
  const actesColSetRef = useRef<Set<string>>(new Set());
  const [actesNoActeIndex, setActesNoActeIndex] = useState<Map<string, number[]>>(new Map());
  const actesNoActeIndexRef = useRef<Map<string, number[]>>(new Map());
  const [envErrors, setEnvErrors] = useState<string[]>([]);
  const [envWarnings, setEnvWarnings] = useState<string[]>([]);

  // — UI —
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // — Dashboard —
  const [dashVue, setDashVue] = useState<"mois" | "trimestre" | "annee">("mois");
  const [dashMonth, setDashMonth] = useState(new Date().getMonth() + 1);
  const [dashYear, setDashYear] = useState(new Date().getFullYear());
  const [dashScope, setDashScope] = useState<"all" | "commune">("all");
  const [dashSelectedCommune, setDashSelectedCommune] = useState<Commune | null>(null);
  const [allAnpcRows, setAllAnpcRows] = useState<AnpcRow[]>([]);
  const [anpcDataLoaded, setAnpcDataLoaded] = useState(false);
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [dashFilters, setDashFilters] = useState<DashFilters>({ arr: [], motif: [], objet: [], selection: [], reglementation: [] });
  const [dashFiltersOpen, setDashFiltersOpen] = useState(false);
  const [dashCommuneQuery, setDashCommuneQuery] = useState("");
  const [dashCommuneDdOpen, setDashCommuneDdOpen] = useState(false);

  // Gestion premier onRecord
  const isFirstRecordEvent = useRef(true);
  const docApiRef = useRef(docApi);

  useEffect(() => { docApiRef.current = docApi; }, [docApi]);

  // ──────────────────────────────────────────
  // Toast helpers
  // ──────────────────────────────────────────
  const showToast = useCallback((kind: Toast["kind"], title: string, message = "", duration = 5000) => {
    const id = ++toastCounter;
    setToasts(prev => [...prev, { id, kind, title, message }]);
    if (kind !== "error" && duration > 0) {
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration);
    }
    return id;
  }, []);

  const closeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // ──────────────────────────────────────────
  // Load Grist metadata choices
  // ──────────────────────────────────────────
  async function loadChoicesFromMetadata(api: typeof docApi, colId: string): Promise<string[]> {
    if (!api) return [];
    const tables = await api.fetchTable("_grist_Tables");
    const cols   = await api.fetchTable("_grist_Tables_column");
    const tableIdCol    = pickCol(tables, ["tableId"]);
    const parentIdCol   = pickCol(cols, ["parentId"]);
    const colIdCol2     = pickCol(cols, ["colId"]);
    const widgetOptionsCol = pickCol(cols, ["widgetOptions"]);
    if (!tableIdCol || !parentIdCol || !colIdCol2 || !widgetOptionsCol) return [];
    const idx = (tables[tableIdCol] as unknown[]).findIndex(v => (v ?? "").toString() === TABLE_ACTES);
    if (idx < 0) return [];
    const tableMetaRowId = (tables.id as number[])[idx];
    const target = norm(colId);
    for (let i = 0; i < (cols.id as unknown[]).length; i++) {
      if ((cols[parentIdCol] as unknown[])[i] !== tableMetaRowId) continue;
      const cid = ((cols[colIdCol2] as unknown[])[i] ?? "").toString();
      if (norm(cid) !== target) continue;
      const woRaw = (cols[widgetOptionsCol] as unknown[])[i];
      if (!woRaw) break;
      try {
        const wo = typeof woRaw === "string" ? JSON.parse(woRaw) : woRaw;
        const choices = (wo as any)?.choices;
        return Array.isArray(choices) ? choices.map((x: unknown) => x?.toString()).filter((s): s is string => Boolean(s)) : [];
      } catch { break; }
    }
    return [];
  }

  // ──────────────────────────────────────────
  // Load communes
  // ──────────────────────────────────────────
  async function loadCommunes(api: typeof docApi) {
    if (!api) return;
    const r = await api.fetchTable(TABLE_COMMUNES);
    const colNom    = pickCol(r, [COM.Nom, "Nom_commune"]);
    const colInsee  = pickCol(r, [COM.INSEE, "Code_INSEE"]);
    const colArr    = pickCol(r, [COM.ARR]);
    const colLog    = pickCol(r, [COM.LOG]);
    const colEnj    = pickCol(r, [COM.ENJEUX]);
    const colHorsZI = pickCol(r, [COM.HORS_ZI]);
    const colRegl   = pickCol(r, ["Reglementation", "Réglementation", "Reglementation_"]);
    if (!colNom || !colInsee || !colArr || !colLog) throw new Error("Colonnes Communes manquantes.");

    const newCommunes: Commune[] = [];
    const newById  = new Map<number, Commune>();
    const newByNom = new Map<string, Commune>();
    const newByInsee = new Map<string, Commune>();

    (r.id as number[]).forEach((id, i) => {
      const nom = cleanStr((r[colNom] as unknown[])[i]);
      if (!nom) return;
      const insee        = cleanStr((r[colInsee] as unknown[])[i]);
      const arr          = cleanStr((r[colArr] as unknown[])[i]);
      const logementsFmt = formatLogements((r[colLog] as unknown[])[i]);
      const reglementation = cleanStr(colRegl ? (r[colRegl] as unknown[])[i] : null);
      const enjeux       = colEnj ? fromGristList((r[colEnj] as unknown[])[i]) : [];
      const horsZI       = colHorsZI ? Boolean((r[colHorsZI] as unknown[])[i]) : true;
      const c: Commune = {
        id, nom, insee, arr, logementsFmt, reglementation, enjeux, horsZI,
        nameNorm: norm(nom), inseeNorm: (insee || "").toString().trim(),
        display: joinDots([nom, insee, arr, logementsFmt, reglementation]),
        metaSelected: joinDots([insee, arr, logementsFmt, reglementation]),
      };
      newCommunes.push(c);
      newById.set(id, c);
      newByNom.set(nom, c);
      if (c.insee) newByInsee.set(String(c.insee), c);
    });

    communesRef.current       = newCommunes;
    communesByIdRef.current   = newById;
    communesByNomRef.current  = newByNom;
    communesByInseeRef.current = newByInsee;
    setCommunes(newCommunes);
  }

  // ──────────────────────────────────────────
  // Load statuts
  // ──────────────────────────────────────────
  async function loadStatuts(api: typeof docApi) {
    if (!api) return;
    let r: Record<string, unknown[]>;
    try {
      r = await api.fetchTable(TABLE_STATUT);
    } catch {
      statutsStatusRef.current = "missing_table";
      setStatutsStatus("missing_table");
      return;
    }
    const colCommune = pickCol(r, ["Commune", "Communes", "CommuneRef"]);
    const colTrim    = pickCol(r, ["Trimestre", "Trimestre_acte"]);
    const colSel     = pickCol(r, ["Selection", "Sélection", "Sélection ?", "Selection ?"]);
    const colDebut   = pickCol(r, ["Debut", "Début", "Date_debut"]);
    const colFin     = pickCol(r, ["Fin", "Date_fin"]);
    if (!colCommune || !colTrim || !colSel) { statutsStatusRef.current = "missing_columns"; setStatutsStatus("missing_columns"); return; }

    const newMap = new Map<string, Statut>();
    (r.id as number[]).forEach((_, i) => {
      const communeRaw = (r[colCommune] as unknown[])[i];
      const communeId  = normalizeCommuneId(communeRaw, communesByNomRef.current, communesByInseeRef.current);
      const trimestre  = cleanStr((r[colTrim] as unknown[])[i]);
      const selection  = cleanSelection((r[colSel] as unknown[])[i]);
      if (typeof communeId !== "number") return;
      if (!trimestre || !selection.length) return;
      const statut: Statut = {
        selection,
        debut: colDebut ? parseDate((r[colDebut] as unknown[])[i]) : null,
        fin:   colFin   ? parseDate((r[colFin] as unknown[])[i])   : null,
      };
      newMap.set(statutKey(communeId, trimestre), statut);
    });
    statutsByKeyRef.current = newMap;
    setStatutsByKey(newMap);
    statutsStatusRef.current = "ok";
    setStatutsStatus("ok");
  }

  // ──────────────────────────────────────────
  // Load actesColSet
  // ──────────────────────────────────────────
  async function loadActesColSet(api: typeof docApi) {
    if (!api) return;
    const r = await api.fetchTable(TABLE_ACTES);
    const cs = new Set(Object.keys(r).filter(k => k !== "id"));
    actesColSetRef.current = cs;
    setActesColSet(cs);
  }

  // ──────────────────────────────────────────
  // Build actesNoActeIndex
  // ──────────────────────────────────────────
  async function buildActesIndex(api: typeof docApi) {
    if (!api) return;
    const r = await api.fetchTable(TABLE_ACTES);
    const colNoActe = pickCol(r, [COLS.NoActe, "N_ACTE", "NoActe"]);
    if (!colNoActe) return;
    const idx = new Map<string, number[]>();
    (r.id as number[]).forEach((rowId, i) => {
      const v = cleanStr((r[colNoActe] as unknown[])[i]);
      if (!v) return;
      const arr = idx.get(v) || [];
      arr.push(rowId);
      idx.set(v, arr);
    });
    actesNoActeIndexRef.current = idx;
    setActesNoActeIndex(idx);
  }

  // ──────────────────────────────────────────
  // Check environment
  // ──────────────────────────────────────────
  function checkEnvironmentNow(sStatus: string, colSet: Set<string>): { errors: string[]; warnings: string[]; ok: boolean } {
    const errs: string[] = [];
    const warns: string[] = [];
    if (sStatus !== "ok") {
      errs.push(`La table "${TABLE_STATUT}" n'est pas prête (statut: ${sStatus}).`);
    }
    const required = [COLS.CommuneRef, COLS.ReceptionPref];
    required.forEach(c => { if (!colSet.has(c)) errs.push(`Colonne "${c}" manquante dans "${TABLE_ACTES}".`); });
    if (!colSet.has(COLS.Trimestre)) warns.push(`Colonne "${COLS.Trimestre}" absente dans "${TABLE_ACTES}".`);
    if (!colSet.has(COLS.SelectionSnapshot)) warns.push(`Colonne "${COLS.SelectionSnapshot}" absente dans "${TABLE_ACTES}".`);
    return { errors: errs, warnings: warns, ok: errs.length === 0 };
  }

  // ──────────────────────────────────────────
  // Init effect
  // ──────────────────────────────────────────
  useEffect(() => {
    if (!docApi) return;
    (async () => {
      try {
        const [tChoices, t2Choices, oChoices] = await Promise.all([
          loadChoicesFromMetadata(docApi, COLS.Type),
          loadChoicesFromMetadata(docApi, COLS.Type2),
          loadChoicesFromMetadata(docApi, COLS.Origine),
        ]);
        setTypeChoices(tChoices);
        setType2Choices(t2Choices);
        setOrigineChoices(oChoices);
        setFormType(tChoices[0] || "");

        await loadCommunes(docApi);
        await loadStatuts(docApi);
        await loadActesColSet(docApi);
        await buildActesIndex(docApi);

        const env = checkEnvironmentNow(statutsStatusRef.current, actesColSetRef.current);
        setEnvErrors(env.errors);
        setEnvWarnings(env.warnings);
      } catch (e: unknown) {
        showToast("error", "Erreur d'initialisation", (e as Error)?.message || String(e));
      } finally {
        setLoading(false);
      }

      // Grist onRecord binding
      const grist = typeof window !== "undefined" ? (window as any).grist : null;
      if (grist && typeof grist.onRecord === "function") {
        grist.onRecord((record: Record<string, unknown>) => {
          if (!record || !record.id) return;
          if (isFirstRecordEvent.current) { isFirstRecordEvent.current = false; return; }
          populateFormFromRecord(record);
        });
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docApi]);

  // ──────────────────────────────────────────
  // Populate form from grist.onRecord
  // ──────────────────────────────────────────
  function populateFormFromRecord(record: Record<string, unknown>) {
    try {
      const isNew = !record[COLS.Type] && !record[COLS.ReceptionPref] && !record[COLS.CommuneRef];
      if (isNew) {
        setModeState("create");
        setCurrentRowId(null);
        resetForm();
        return;
      }
      setCurrentRecord(record);
      setModeState("edit");
      setCurrentRowId(record.id as number);

      setFormType((record[COLS.Type] as string) ?? "");
      setFormType2((record[COLS.Type2] as string) ?? "");
      setFormOrigine((record[COLS.Origine] as string) ?? "");
      setFormNoActe((record[COLS.NoActe] as string) ?? "");
      setFormNParcelle((record[COLS.NParcelle] as string) ?? "");
      setFormNomProjet((record[COLS.NomProjet] as string) ?? "");
      setFormVisaMairie((record[COLS.VisaMairie] as string) ?? "");
      setFormReceptionPref((record[COLS.ReceptionPref] as string) ?? "");

      const motifsSel = fromGristList(record[COLS.Enjeux]);
      const objetsSel = fromGristList(record[COLS.MotifsControle]);
      setSelectedMotifs(motifsSel);
      setSelectedObjets(objetsSel);

      // Restore enjeu values
      const vals: Record<string, "Oui" | "Non"> = {};
      const allItems = [...motifsSel, ...objetsSel];
      for (const item of allItems) {
        const v = record[enjeuColForItem(item)];
        if (v === "Oui" || v === "Non") vals[item] = v;
      }
      const legacyEnjeu = record[COLS.EnjeuOld];
      if ((legacyEnjeu === "Oui" || legacyEnjeu === "Non") && motifsSel.length > 0) {
        for (const m of motifsSel) { if (!vals[m]) vals[m] = legacyEnjeu as "Oui" | "Non"; }
      }
      setEnjeuValues(vals);

      // Taille
      const tailleVal = record[COLS.TailleLogements];
      setTailleLogements(tailleVal != null && tailleVal !== "" ? String(tailleVal) : "");

      // Commune
      const rawCommune = record[COLS.CommuneRef];
      let targetCommune: Commune | null = null;
      if (typeof rawCommune === "number") {
        targetCommune = communesByIdRef.current.get(rawCommune) ?? null;
      } else if (typeof rawCommune === "string") {
        targetCommune = communesByNomRef.current.get(rawCommune.trim()) ?? null;
      } else if (Array.isArray(rawCommune)) {
        const maybeId = rawCommune.find((x): x is number => typeof x === "number");
        const maybeLabel = rawCommune.find((x): x is string => typeof x === "string");
        if (typeof maybeId === "number") targetCommune = communesByIdRef.current.get(maybeId) ?? null;
        else if (typeof maybeLabel === "string") targetCommune = communesByNomRef.current.get(maybeLabel.trim()) ?? null;
      }

      if (targetCommune) {
        handleSelectCommune(targetCommune);
      } else {
        setSelectedCommune(null);
        selectedCommuneRef.current = null;
        setCommuneQuery("");
      }
      setErrors({});
    } catch (e: unknown) {
      showToast("error", "Erreur onRecord", (e as Error)?.message || String(e));
    }
  }

  // ──────────────────────────────────────────
  // Commune selection
  // ──────────────────────────────────────────
  function handleSelectCommune(c: Commune) {
    selectedCommuneRef.current = c;
    setSelectedCommune(c);
    setCommuneQuery(c.nom);
    setCommuneDdOpen(false);
    setCommuneDdItems([]);
    setCommuneAutoChecked(new Set());
    communeAutoCheckedRef.current.clear();

    // Auto-check enjeux from commune
    const toCheck = new Set<string>();
    if (c.enjeux && c.enjeux.length) {
      c.enjeux.forEach(enjeu => {
        const val = COMMUNE_ENJEUX_MAP[enjeu];
        if (val) toCheck.add(val);
      });
    }
    if (c.horsZI === false) toCheck.add("ZI");

    if (toCheck.size > 0) {
      const newAutoChecked = new Set<string>();
      // Check motifs
      setSelectedMotifs(prev => {
        const next = [...prev];
        for (const val of toCheck) {
          if ((ALL_MOTIFS as readonly string[]).includes(val) && !next.includes(val)) {
            next.push(val);
            newAutoChecked.add(val);
          }
        }
        return next;
      });
      // Check objets (LLS)
      setSelectedObjets(prev => {
        const next = [...prev];
        for (const val of toCheck) {
          if ((ALL_OBJETS as readonly string[]).includes(val) && !next.includes(val)) {
            next.push(val);
            newAutoChecked.add(val);
          }
        }
        return next;
      });
      setCommuneAutoChecked(newAutoChecked);
      communeAutoCheckedRef.current = newAutoChecked;
    }
    setErrors(prev => ({ ...prev, commune: "" }));
  }

  function handleClearCommune() {
    // Uncheck auto-checked items
    const auto = communeAutoCheckedRef.current;
    setSelectedMotifs(prev => prev.filter(m => !auto.has(m)));
    setSelectedObjets(prev => prev.filter(o => !auto.has(o)));
    setEnjeuValues(prev => {
      const next = { ...prev };
      for (const k of auto) delete next[k];
      return next;
    });
    setCommuneAutoChecked(new Set());
    communeAutoCheckedRef.current = new Set();
    setSelectedCommune(null);
    selectedCommuneRef.current = null;
    setCommuneQuery("");
    setCommuneDdItems([]);
    setCommuneDdOpen(false);
  }

  const debouncedCommuneSearch = useRef(
    debounce((q: string) => {
      const exact = communesByNomRef.current.get(q.trim());
      if (exact) { handleSelectCommune(exact); return; }
      const items = filterCommunesFromList(communesRef.current, q);
      setCommuneDdItems(items);
      setCommuneDdOpen(items.length > 0);
    }, DEBOUNCE_DELAY_MS)
  ).current;

  // ──────────────────────────────────────────
  // Controle logic
  // ──────────────────────────────────────────
  function getSelectionForPayload(
    payload: Record<string, unknown>,
    communesByIdMap: Map<number, Commune>,
    statutsByKeyMap: Map<string, Statut>,
  ): { selection: string[]; trimestre: string; found: boolean } {
    const communeId = payload[COLS.CommuneRef] as number | null;
    const receptionPref = payload[COLS.ReceptionPref] as string | null;
    const trimestre = computeTrimestreFromDate(receptionPref) || "";
    const explicit = getStatutSelection(statutsByKeyMap, communeId, trimestre, receptionPref || "");
    const selection = explicit.length ? explicit : [DEFAULT_SELECTION];
    return { selection, trimestre, found: explicit.length > 0 };
  }

  function applyControleLogicNonEcrasant(
    payload: Record<string, unknown>,
    existingRecord: Record<string, unknown> | null,
    communesByIdMap: Map<number, Commune>,
    statutsByKeyMap: Map<string, Statut>,
  ): Record<string, unknown> {
    const inEdit = !!(existingRecord?.id);
    const existingControle = inEdit ? existingRecord![COLS.Controle] : null;
    const existingRaison   = inEdit ? existingRecord![COLS.RaisonControle] : null;
    const controleAlreadySet = inEdit && typeof existingControle === "boolean";
    const raisonAlreadySet   = inEdit && isNonEmptyChoiceList(existingRaison);
    if (controleAlreadySet && raisonAlreadySet) return payload;

    const communeId = payload[COLS.CommuneRef] as number | null;
    const commune = (typeof communeId === "number") ? communesByIdMap.get(communeId) : null;
    let selections: string[] = [];
    if (statutsByKeyMap.size) {
      selections = getSelectionForPayload(payload, communesByIdMap, statutsByKeyMap).selection;
    } else {
      selections = [(commune as any)?.selection || ""].filter(Boolean);
    }

    const motifs = fromGristList(payload[COLS.Enjeux]);
    const enjeuZI = ((payload[enjeuColForItem("ZI")] ?? payload[COLS.EnjeuOld] ?? "") as string);
    const hasZI = motifs.includes("ZI");

    let controle = false;
    let raison = "Sans impact";
    if (selectionHasAny(selections, ["Ciblée", "Fixe", "Rotation"])) {
      controle = true; raison = "Commune aléatoire";
    } else if (enjeuZI === "Oui" && hasZI) {
      controle = true; raison = "En ZI";
    } else if (enjeuZI === "Non" && hasZI) {
      controle = false; raison = "Pas en ZI";
    }

    if (!controleAlreadySet) payload[COLS.Controle] = controle;
    if (!raisonAlreadySet) payload[COLS.RaisonControle] = raison;
    return payload;
  }

  function computeControlePreview(
    motifs: string[],
    enjeuVals: Record<string, "Oui" | "Non">,
    commune: Commune | null,
    receptionPref: string,
    statutsByKeyMap: Map<string, Statut>,
  ): { controle: boolean; raison: string } {
    const trimestre = computeTrimestreFromDate(receptionPref) || DEFAULT_TRIMESTRE;
    const selections = commune
      ? getStatutSelection(statutsByKeyMap, commune.id, trimestre, receptionPref)
      : [];
    const enjeuZI = enjeuVals["ZI"] ?? "";
    const hasZI = motifs.includes("ZI");
    if (selectionHasAny(selections, ["Ciblée", "Fixe", "Rotation"])) return { controle: true, raison: "Commune aléatoire" };
    if (enjeuZI === "Oui" && hasZI) return { controle: true, raison: "En ZI" };
    if (enjeuZI === "Non" && hasZI) return { controle: false, raison: "Pas en ZI" };
    return { controle: false, raison: "Sans impact" };
  }

  // ──────────────────────────────────────────
  // isProjetConcerne
  // ──────────────────────────────────────────
  function isProjetConcerne(
    selMotifs: string[],
    selObjets: string[],
    commune: Commune | null,
    receptionPref: string,
    statutsByKeyMap: Map<string, Statut>,
    tailleVal: string,
  ): boolean {
    const INDOLORES = new Set(["ERP 4/5", "Taille"]);
    if (selMotifs.length > 0) return true;
    const objetsCibléés = selObjets.filter(o => !INDOLORES.has(o));
    if (objetsCibléés.length > 0) return true;
    if (!commune) return false;
    const trimestre = computeTrimestreFromDate(receptionPref) || DEFAULT_TRIMESTRE;
    const selections = getStatutSelection(statutsByKeyMap, commune.id, trimestre, receptionPref);
    if (selectionHasAny(selections, ["Fixe", "Ciblée", "Rotation"])) return true;
    if (selObjets.includes("Taille")) {
      const tv = parseInt(tailleVal, 10);
      const seuil = getSeuilLogements(commune);
      if (!isNaN(tv) && tv >= seuil) return true;
    }
    return false;
  }

  // ──────────────────────────────────────────
  // Build payload
  // ──────────────────────────────────────────
  function buildPayload(): Record<string, unknown> {
    const INDOLORES = new Set(["ERP 4/5", "Taille"]);
    const allItems = [...selectedMotifs, ...selectedObjets];
    const enjeuCols = Object.fromEntries(
      [...ALL_MOTIFS, ...ALL_OBJETS].map(item => {
        const isSelected = allItems.includes(item);
        let v: unknown = null;
        if (isSelected) v = INDOLORES.has(item) ? "Oui" : (enjeuValues[item] ?? null);
        return [enjeuColForItem(item), v];
      })
    );

    const tailleCoché = selectedObjets.includes("Taille");
    const tailleVal = tailleCoché ? (parseInt(tailleLogements, 10) || null) : null;

    const payload: Record<string, unknown> = {
      [COLS.Type]: formType || null,
      [COLS.Type2]: formType2 || null,
      [COLS.NoActe]: cleanStr(formNoActe) || null,
      [COLS.NParcelle]: cleanStr(formNParcelle) || null,
      [COLS.NomProjet]: cleanStr(formNomProjet) || null,
      [COLS.VisaMairie]: formVisaMairie || null,
      [COLS.ReceptionPref]: formReceptionPref || null,
      [COLS.Origine]: formOrigine || null,
      [COLS.Enjeux]: toGristList(selectedMotifs),
      [COLS.MotifsControle]: toGristList(selectedObjets),
      ...enjeuCols,
      [COLS.EnjeuOld]: selectedMotifs.length === 1 ? (enjeuValues[selectedMotifs[0]] ?? null) : null,
      [COLS.CommuneRef]: selectedCommuneRef.current?.id ?? null,
      [COLS.TailleLogements]: tailleVal,
    };

    const selInfo = getSelectionForPayload(payload, communesByIdRef.current, statutsByKeyRef.current);
    if (actesColSetRef.current.has(COLS.Trimestre)) payload[COLS.Trimestre] = selInfo.trimestre || null;
    if (actesColSetRef.current.has(COLS.SelectionSnapshot)) payload[COLS.SelectionSnapshot] = selInfo.selection[0] || null;

    return payload;
  }

  // ──────────────────────────────────────────
  // Validate form
  // ──────────────────────────────────────────
  function validateFormNow(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (!formType) errs.type = "Champ obligatoire";
    if (!formType2) errs.type2 = "Champ obligatoire";
    if (!formVisaMairie) errs.visaMairie = "Champ obligatoire";
    if (!formReceptionPref) errs.receptionPref = "Champ obligatoire";
    if (!selectedCommuneRef.current) errs.commune = "Veuillez sélectionner une commune";
    if (!formOrigine) errs.origine = "Veuillez sélectionner une origine";

    // Enjeux validation (if project is concerned)
    const INDOLORES_VALID = new Set(["ERP 4/5", "Taille"]);
    const concerned = isProjetConcerne(selectedMotifs, selectedObjets, selectedCommuneRef.current, formReceptionPref, statutsByKeyRef.current, tailleLogements);
    if (concerned) {
      const allItems = [...selectedMotifs, ...selectedObjets];
      for (const item of allItems) {
        if (INDOLORES_VALID.has(item)) continue;
        if (!enjeuValues[item]) errs[`enjeu_${item}`] = "Veuillez choisir Oui ou Non";
      }
    }

    // Taille validation
    if (selectedObjets.includes("Taille")) {
      const tv = parseInt(tailleLogements, 10);
      if (isNaN(tv) || tailleLogements.trim() === "") errs.taille = "Obligatoire si Taille est cochée";
    }

    // N° ACTE unicity
    const noActeVal = cleanStr(formNoActe);
    if (noActeVal) {
      const hits = actesNoActeIndexRef.current.get(noActeVal) || [];
      const clash = hits.some(id => mode === "create" ? true : id !== currentRowId);
      if (clash) errs.noActe = "Ce N° ACTE existe déjà";
    }

    return errs;
  }

  // ──────────────────────────────────────────
  // Reset form
  // ──────────────────────────────────────────
  function resetForm() {
    setFormType(typeChoices[0] || "");
    setFormType2(TYPE2_DEFAULT);
    setFormOrigine(ORIGINE_DEFAULT);
    setFormNoActe("");
    setFormNParcelle("");
    setFormNomProjet("");
    setFormVisaMairie("");
    setFormReceptionPref("");
    setSelectedMotifs([]);
    setSelectedObjets([]);
    setEnjeuValues({});
    setTailleLogements("");
    setSelectedCommune(null);
    selectedCommuneRef.current = null;
    setCommuneQuery("");
    setCommuneDdItems([]);
    setCommuneDdOpen(false);
    setCommuneAutoChecked(new Set());
    communeAutoCheckedRef.current = new Set();
    setErrors({});
    setCurrentRecord(null);
  }

  // ──────────────────────────────────────────
  // Save
  // ──────────────────────────────────────────
  async function handleSave() {
    if (!docApi) { showToast("error", "API Grist non disponible", ""); return; }
    const env = checkEnvironmentNow(statutsStatus, actesColSetRef.current);
    if (!env.ok) { showToast("error", "Configuration incomplète", env.errors.join("\n")); return; }

    setBusy(true);
    try {
      await buildActesIndex(docApi);
      const errs = validateFormNow();
      if (Object.keys(errs).length > 0) {
        setErrors(errs);
        showToast("error", "Formulaire incomplet", "Merci de corriger les champs indiqués.");
        return;
      }

      let payload = buildPayload();
      payload = applyControleLogicNonEcrasant(payload, currentRecord, communesByIdRef.current, statutsByKeyRef.current);

      const wasCreate = mode === "create";

      if (wasCreate) {
        await docApi.applyUserActions([["AddRecord", TABLE_ACTES, null, payload]]);
        showToast("success", "Contrôle créé", `${selectedCommune?.nom || ""}`, 12000);
        resetForm();
        setModeState("create");
        setCurrentRowId(null);
        setAnpcDataLoaded(false);
      } else {
        await docApi.applyUserActions([["UpdateRecord", TABLE_ACTES, currentRowId, payload]]);
        showToast("success", "Contrôle mis à jour", `${selectedCommune?.nom || ""}`, 12000);
        setAnpcDataLoaded(false);
      }
    } catch (e: unknown) {
      const msg = (e as Error)?.message || String(e);
      if (/access|forbidden|permission|denied|unauthorized/i.test(msg)) {
        showToast("error", "Accès insuffisant", "Dans les options du widget, mets 'Full access'.");
      } else {
        showToast("error", "Erreur", msg);
      }
    } finally {
      setBusy(false);
    }
  }

  // ──────────────────────────────────────────
  // Dashboard: load data
  // ──────────────────────────────────────────
  async function loadAllAnpcData() {
    if (anpcDataLoaded || !docApi) return;
    try {
      const r = await docApi.fetchTable(TABLE_ACTES);
      const colMajcs       = pickCol(r, ["MAJCS"]);
      const colCommune     = pickCol(r, ["Communes"]);
      const colType        = pickCol(r, ["Type"]);
      const colType2       = pickCol(r, ["Type2"]);
      const colMotif       = pickCol(r, ["Enjeux_pre_identifies", "MN_Motifs_de_selection"]);
      const colObjet       = pickCol(r, ["Motifs_controle", "Objet_autorisation"]);
      const colVisa        = pickCol(r, ["Visa_Mairie"]);
      const colReception   = pickCol(r, ["Reception_Pref"]);
      const colNActe       = pickCol(r, ["N_ACTE", "N_Acte"]);
      const colNomProjet   = pickCol(r, ["Nom_du_projet", "Nom_projet"]);
      const colCreatedBy   = pickCol(r, ["CreatedByName"]);

      const rows: AnpcRow[] = (r.id as number[]).map((id, i) => {
        const majcsRaw   = colMajcs ? (r[colMajcs] as unknown[])[i] : id;
        const communeRaw = colCommune ? (r[colCommune] as unknown[])[i] : null;
        const communeId  = normalizeCommuneId(communeRaw, communesByNomRef.current, communesByInseeRef.current);
        const receptionPrefRaw = colReception ? (r[colReception] as unknown[])[i] : null;
        const receptionPref = receptionPrefRaw ? parseDate(receptionPrefRaw) : null;
        const visaMairieRaw = colVisa ? (r[colVisa] as unknown[])[i] : null;
        const visaMairie = visaMairieRaw ? parseDate(visaMairieRaw) : null;
        const communeData = communeId ? communesByIdRef.current.get(communeId) : undefined;
        return {
          id,
          majcs: String(majcsRaw || id),
          communeId,
          communeName: communeData?.nom || "?",
          arr: communeData?.arr || "—",
          logements: communeData?.logementsFmt || "—",
          nActe: cleanStr(colNActe ? (r[colNActe] as unknown[])[i] : "") || "—",
          nomProjet: cleanStr(colNomProjet ? (r[colNomProjet] as unknown[])[i] : "") || "—",
          type: cleanStr(colType ? (r[colType] as unknown[])[i] : ""),
          type2: cleanStr(colType2 ? (r[colType2] as unknown[])[i] : ""),
          motif: colMotif ? (r[colMotif] as unknown[])[i] : null,
          objet: colObjet ? (r[colObjet] as unknown[])[i] : null,
          visaMairie,
          receptionPref,
          createdByName: cleanStr(colCreatedBy ? (r[colCreatedBy] as unknown[])[i] : "") || "—",
        };
      }).filter(row => row.communeId !== null);

      setAllAnpcRows(rows);
      setAnpcDataLoaded(true);
    } catch (e: unknown) {
      showToast("error", "Erreur chargement dashboard", (e as Error)?.message || String(e));
    }
  }

  // Load dashboard data when tab switches
  useEffect(() => {
    if (tab === "dashboard" && !anpcDataLoaded) {
      loadAllAnpcData();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, anpcDataLoaded]);

  // ──────────────────────────────────────────
  // Dashboard: filter rows for period
  // ──────────────────────────────────────────
  function getRowsForPeriod(rows: AnpcRow[]): AnpcRow[] {
    return rows.filter(row => {
      if (!row.receptionPref) return dashVue === "annee";
      const m = row.receptionPref.getMonth() + 1;
      const y = row.receptionPref.getFullYear();
      if (dashVue === "mois") return y === dashYear && m === dashMonth;
      if (dashVue === "trimestre") {
        const t = Math.floor((dashMonth - 1) / 3) + 1;
        return y === dashYear && m >= (t - 1) * 3 + 1 && m <= t * 3;
      }
      return y === dashYear;
    });
  }

  function applyDashFilters(rows: AnpcRow[]): AnpcRow[] {
    return rows.filter(row => {
      if (dashFilters.arr.length > 0 && !dashFilters.arr.includes(row.arr)) return false;
      if (dashFilters.motif.length > 0) {
        const motifs = fromGristList(row.motif);
        if (!dashFilters.motif.some(m => motifs.includes(m))) return false;
      }
      if (dashFilters.objet.length > 0) {
        const objets = fromGristList(row.objet);
        if (!dashFilters.objet.some(o => objets.includes(o))) return false;
      }
      if (dashScope === "commune" && dashSelectedCommune) {
        if (row.communeId !== dashSelectedCommune.id) return false;
      }
      return true;
    });
  }

  function sortRows(rows: AnpcRow[]): AnpcRow[] {
    if (!sortField) return rows;
    return [...rows].sort((a, b) => {
      const av = (a as any)[sortField] ?? "";
      const bv = (b as any)[sortField] ?? "";
      const cmp = av instanceof Date && bv instanceof Date
        ? av.getTime() - bv.getTime()
        : String(av).localeCompare(String(bv), "fr");
      return sortDir === "asc" ? cmp : -cmp;
    });
  }

  function navigateDashPeriod(delta: number) {
    if (dashVue === "mois") {
      let m = dashMonth + delta;
      let y = dashYear;
      if (m < 1) { m = 12; y--; } else if (m > 12) { m = 1; y++; }
      setDashMonth(m); setDashYear(y);
    } else if (dashVue === "trimestre") {
      let t = Math.floor((dashMonth - 1) / 3) + 1 + delta;
      let y = dashYear;
      if (t < 1) { t = 4; y--; } else if (t > 4) { t = 1; y++; }
      setDashMonth((t - 1) * 3 + 1); setDashYear(y);
    } else {
      setDashYear(y => y + delta);
    }
  }

  function getRowSelections(row: AnpcRow): string[] {
    if (!row.communeId) return [];
    const found = new Set<string>();
    if (dashVue === "annee") {
      for (const [key, statut] of statutsByKeyRef.current.entries()) {
        if (key.startsWith(String(row.communeId) + "|") && statut.selection) {
          statut.selection.filter(s => SHOW_SELECTIONS.has(s)).forEach(s => found.add(s));
        }
      }
    } else {
      const tri = computeTrimestreFromDate(row.receptionPref ? row.receptionPref.toISOString().split("T")[0] : "");
      if (tri) {
        const statut = statutsByKeyRef.current.get(statutKey(row.communeId, tri));
        if (statut?.selection) statut.selection.filter(s => SHOW_SELECTIONS.has(s)).forEach(s => found.add(s));
      }
    }
    return Array.from(found);
  }

  // ──────────────────────────────────────────
  // Computed derived values
  // ──────────────────────────────────────────
  const currentTrimestre = computeTrimestreFromDate(formReceptionPref) || DEFAULT_TRIMESTRE;
  const currentSelections = selectedCommune
    ? getStatutSelection(statutsByKeyRef.current, selectedCommune.id, currentTrimestre, formReceptionPref)
    : [];
  const visibleSelBadges = currentSelections.filter(s => SHOW_SELECTIONS.has(s));
  // padding-right dynamique : 2.5rem (bouton ×) + N × 5.5rem par badge sélection
  const communeInputPaddingRight = visibleSelBadges.length > 0
    ? `${2.5 + visibleSelBadges.length * 5.5}rem`
    : undefined;

  const communeConcernee = currentSelections.some(s => SHOW_SELECTIONS.has(s)) ||
    [...selectedMotifs, ...selectedObjets].some(item => {
      if (item === "ERP 4/5" || item === "Taille") return false;
      return enjeuValues[item] === "Oui" && ["ZI", "RT", "STEP", "PEB", "LLS"].includes(item);
    });

  const projetConcerne = (() => {
    const PROJET_ITEMS = ["ZN", "ZA", "EE", "Site classé", "ERP 1/2/3", "Signalé", "Aléatoire"];
    const enjeuProjetOui = PROJET_ITEMS.some(item => enjeuValues[item] === "Oui");
    let tailleOui = false;
    if (selectedObjets.includes("Taille")) {
      const tv = parseInt(tailleLogements, 10);
      const seuil = selectedCommune ? getSeuilLogements(selectedCommune) : Infinity;
      if (!isNaN(tv) && tv >= seuil) tailleOui = true;
    }
    return enjeuProjetOui || tailleOui;
  })();

  const controlePreview = computeControlePreview(
    selectedMotifs, enjeuValues, selectedCommune, formReceptionPref, statutsByKeyRef.current
  );

  const envOk = envErrors.length === 0;

  // ──────────────────────────────────────────
  // Dashboard filtered rows
  // ──────────────────────────────────────────
  const periodRows  = getRowsForPeriod(allAnpcRows);
  const filteredRows = sortRows(applyDashFilters(periodRows));

  // Unique filter values
  const ARR_ORDER = ["Toulouse", "Muret", "Saint-Gaudens"];
  const uniqueArrs = ARR_ORDER.filter(a => allAnpcRows.some(r => r.arr === a));
  const uniqueMotifs = [...new Set(allAnpcRows.flatMap(r => fromGristList(r.motif)))].sort();
  const uniqueObjets = [...new Set(allAnpcRows.flatMap(r => fromGristList(r.objet)))].sort();

  // ──────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────
  return (
    <div className="app-shell">
      {loading && (
        <div className="loading-overlay">
          <div className="loading-spinner" />
          <p className="fr-text--lg fr-mt-2w">Chargement des données…</p>
        </div>
      )}
      <ToastContainer toasts={toasts} onClose={closeToast} />

      <div className="app-main">
        {/* Header */}
        <header className="app-header" role="banner">
          <div className="app-header__left">
            <div className="app-header__logo">
              <i className="fa-solid fa-landmark" aria-hidden="true" />
              DDT 31
            </div>
            <div className="app-header__title">
              Enregistrement
            </div>
          </div>
          <nav className="app-tabs" role="tablist" aria-label="Modes">
            <button
              className={`app-tab ${tab === "saisie" ? "active" : ""}`}
              role="tab" type="button"
              onClick={() => setTab("saisie")}
            >
              <i className="fa-solid fa-pen-to-square" aria-hidden="true" /> Saisie
            </button>
            <button
              className={`app-tab ${tab === "dashboard" ? "active" : ""}`}
              role="tab" type="button"
              onClick={() => setTab("dashboard")}
            >
              <i className="fa-solid fa-chart-column" aria-hidden="true" /> Tableau de bord
            </button>
          </nav>
          <div className="app-header__right">
            {gristUser && (
              <div className="app-header__user" title={gristUser.email}>
                <i className="fa-solid fa-circle-user" />
                <span>{gristUser.name}</span>
              </div>
            )}
          </div>
        </header>

        <main className="app-content" role="main">
          {/* Env issues */}
          {!loading && (envErrors.length > 0 || envWarnings.length > 0) && (
            <div>
              {envErrors.map((t, i) => (
                <div key={i} className="fr-alert fr-alert--error fr-alert--sm fr-mb-1w">
                  <p className="fr-alert__title">Configuration requise</p><p>{t}</p>
                </div>
              ))}
              {envWarnings.map((t, i) => (
                <div key={i} className="fr-alert fr-alert--warning fr-alert--sm fr-mb-1w">
                  <p className="fr-alert__title">À vérifier</p><p>{t}</p>
                </div>
              ))}
            </div>
          )}

          {/* Tab: Saisie */}
          {tab === "saisie" && (
            <div>
              {mode === "edit" && (
                <div className="mode-zone">
                  <span className="mode-help">Ligne sélectionnée (id={currentRowId}).</span>
                </div>
              )}

              {/* Section 1: Infos générales */}
              <section className="form-section" aria-labelledby="section-acte-title">
                <h2 className="form-section__title" id="section-acte-title">
                  <i className="fa-solid fa-file-alt section-icon" aria-hidden="true" />
                  Informations générales
                </h2>
                <div className="fr-grid-row fr-grid-row--gutters">
                  {/* Réception préf */}
                  <div className="fr-col-12 fr-col-md-2">
                    <div className={`date-group ctrl-group${errors.receptionPref ? " fr-input-group--error" : ""}`}>
                      <label className="fr-label" htmlFor="receptionPref">
                        <i className="fa-solid fa-calendar" /> Réception préf. <span className="req">*</span>
                      </label>
                      <input id="receptionPref" className={`field-styled${formReceptionPref ? "" : " is-empty"}`} type="date"
                        value={formReceptionPref}
                        onChange={e => { setFormReceptionPref(e.target.value); setErrors(p => ({ ...p, receptionPref: "" })); }}
                        aria-invalid={errors.receptionPref ? "true" : undefined}
                      />
                      {errors.receptionPref && <p className="fr-error-text fr-mt-1v">{errors.receptionPref}</p>}
                    </div>
                  </div>
                  {/* Visa mairie */}
                  <div className="fr-col-12 fr-col-md-2">
                    <div className={`date-group ctrl-group${errors.visaMairie ? " fr-input-group--error" : ""}`}>
                      <label className="fr-label" htmlFor="visaMairie">
                        <i className="fa-solid fa-calendar" /> Visa mairie <span className="req">*</span>
                      </label>
                      <input id="visaMairie" className={`field-styled${formVisaMairie ? "" : " is-empty"}`} type="date"
                        value={formVisaMairie}
                        onChange={e => { setFormVisaMairie(e.target.value); setErrors(p => ({ ...p, visaMairie: "" })); }}
                        aria-invalid={errors.visaMairie ? "true" : undefined}
                      />
                      {errors.visaMairie && <p className="fr-error-text fr-mt-1v">{errors.visaMairie}</p>}
                    </div>
                  </div>
                  {/* Type */}
                  <div className="fr-col-12 fr-col-md-3">
                    <div className={`ctrl-group${errors.type ? " fr-input-group--error" : ""}`}>
                      <label className="fr-label">
                        <i className="fa-solid fa-list" /> Type d'acte <span className="req">*</span>
                      </label>
                      <TypeDropdown
                        value={formType} choices={typeChoices} labels={TYPE_LABELS}
                        placeholder="—" onChange={v => { setFormType(v); setErrors(e => ({ ...e, type: "" })); }}
                        hasError={!!errors.type}
                      />
                      {errors.type && <p className="fr-error-text fr-mt-1v">{errors.type}</p>}
                    </div>
                  </div>
                  {/* Type2 */}
                  <div className="fr-col-12 fr-col-md-3">
                    <div className={`ctrl-group${errors.type2 ? " fr-input-group--error" : ""}`}>
                      <label className="fr-label">
                        <i className="fa-solid fa-scroll" /> Type de permis <span className="req">*</span>
                      </label>
                      <TypeDropdown
                        value={formType2} choices={type2Choices} labels={TYPE2_LABELS}
                        placeholder="—" onChange={v => { setFormType2(v); setErrors(e => ({ ...e, type2: "" })); }}
                        hasError={!!errors.type2}
                      />
                      {errors.type2 && <p className="fr-error-text fr-mt-1v">{errors.type2}</p>}
                    </div>
                  </div>
                  {/* Origine */}
                  <div className="fr-col-12 fr-col-md-2">
                    <div className={`ctrl-group${errors.origine ? " fr-input-group--error" : ""}`}>
                      <label className="fr-label">
                        <i className="fa-solid fa-building" /> Origine <span className="req">*</span>
                      </label>
                      <TypeDropdown
                        value={formOrigine} choices={origineChoices}
                        placeholder="—" onChange={v => { setFormOrigine(v); setErrors(e => ({ ...e, origine: "" })); }}
                        hasError={!!errors.origine}
                      />
                      {errors.origine && <p className="fr-error-text fr-mt-1v">{errors.origine}</p>}
                    </div>
                  </div>
                  {/* Nom projet */}
                  <div className="fr-col-12 fr-col-md-6 col-stretch">
                    <div className="fr-input-group group-stretch">
                      <label className="fr-label" htmlFor="nomProjet">Nom du projet</label>
                      <textarea id="nomProjet" className="fr-input field-styled textarea-stretch"
                        value={formNomProjet} onChange={e => setFormNomProjet(e.target.value)} />
                    </div>
                  </div>
                  {/* N° Acte + Parcelle */}
                  <div className="fr-col-12 fr-col-md-6 col-stretch">
                    <div className={`fr-input-group${errors.noActe ? " fr-input-group--error" : ""}`}>
                      <label className="fr-label" htmlFor="noActe">N° de l'acte</label>
                      <input id="noActe" className="fr-input field-styled mono" type="text"
                        value={formNoActe}
                        onChange={e => { setFormNoActe(e.target.value); setErrors(p => ({ ...p, noActe: "" })); }}
                        aria-invalid={errors.noActe ? "true" : undefined}
                      />
                      {errors.noActe && <p className="fr-error-text fr-mt-1v">{errors.noActe}</p>}
                    </div>
                    <div className="fr-input-group fr-mt-2w">
                      <label className="fr-label" htmlFor="nParcelle">N° de la parcelle (ou adresse)</label>
                      <input id="nParcelle" className="fr-input field-styled mono" type="text"
                        value={formNParcelle} onChange={e => setFormNParcelle(e.target.value)} />
                    </div>
                  </div>
                </div>
              </section>

              {/* Section 2: Contrôle de légalité */}
              <section className="form-section" aria-labelledby="section-controle-title">
                <h2 className="form-section__title" id="section-controle-title">
                  <i className="fa-solid fa-balance-scale section-icon" aria-hidden="true" />
                  Contrôle de légalité
                </h2>

                {/* Commune search */}
                <div className="controle-subsection">
                  <div className="commune-oneline">
                    <div className="commune-oneline__input">
                      <div className={`commune-search-wrapper dd${errors.commune ? " fr-input-group--error" : ""}`}
                        style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        {selectedCommune?.arr && (
                          <span className="tag tag--light" style={{ whiteSpace: "nowrap", flexShrink: 0 }}>
                            {selectedCommune.arr}
                          </span>
                        )}
                        <div className={`commune-input-wrap${selectedCommune?.arr ? " has-arr" : ""}`} style={{ flex: 1, position: "relative" }}>
                          <input
                            className="field-styled commune-input"
                            placeholder="Sélectionner une commune…"
                            autoComplete="off"
                            style={communeInputPaddingRight ? { paddingRight: communeInputPaddingRight } : undefined}
                            value={communeQuery}
                            onChange={e => {
                              setCommuneQuery(e.target.value);
                              setErrors(p => ({ ...p, commune: "" }));
                              if (!e.target.value) { setSelectedCommune(null); selectedCommuneRef.current = null; }
                              debouncedCommuneSearch(e.target.value);
                            }}
                            onFocus={() => {
                              if (communeQuery) {
                                const items = filterCommunesFromList(communesRef.current, communeQuery);
                                setCommuneDdItems(items); setCommuneDdOpen(items.length > 0);
                              }
                            }}
                            onBlur={() => setTimeout(() => setCommuneDdOpen(false), 150)}
                            aria-invalid={errors.commune ? "true" : undefined}
                          />
                          {/* Sélection badges */}
                          {selectedCommune && currentSelections.length > 0 && (
                            <span className="commune-input-badges" style={{ display: "flex", position: "absolute", right: "2.5rem", top: "50%", transform: "translateY(-50%)", pointerEvents: "none", gap: "0.25rem" }}>
                              {currentSelections.filter(s => SHOW_SELECTIONS.has(s)).map(s => (
                                <span key={s} className={`commune-arr-badge commune-arr-badge--sel is-visible sel-${s.toLowerCase().replace("é", "e")}`}>{s}</span>
                              ))}
                            </span>
                          )}
                          {communeQuery && (
                            <button type="button" className="commune-clear-btn" aria-label="Effacer"
                              style={{ display: "flex" }}
                              onClick={handleClearCommune}>
                              <i className="fa-solid fa-xmark" />
                            </button>
                          )}
                          {/* Dropdown */}
                          {communeDdOpen && communeDdItems.length > 0 && (
                            <div className="dd-panel" role="listbox" style={{ display: "block" }}>
                              {communeDdItems.map(c => (
                                <button key={c.id} type="button" className="dd-item"
                                  onMouseDown={() => handleSelectCommune(c)}>
                                  {c.arr && <span className="type-dd__item-badge dd-arr-badge">{c.arr}</span>}
                                  <div className="dd-item-body">
                                    <span className="dd-title">{c.nom}</span>
                                    {c.reglementation && (
                                      <span className="dd-sub-info"> • {c.reglementation}</span>
                                    )}
                                  </div>
                                  {c.logementsFmt && <span className="dd-item-logements">{c.logementsFmt}</span>}
                                  {selectedCommune?.id === c.id && <span className="dd-item-check">✓</span>}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        {selectedCommune?.logementsFmt && (
                          <span className="tag tag--light" style={{ whiteSpace: "nowrap", flexShrink: 0 }}>
                            {selectedCommune.logementsFmt}
                          </span>
                        )}
                      </div>
                      {errors.commune && <p className="fr-error-text fr-mt-1v">{errors.commune}</p>}
                    </div>
                  </div>
                </div>

                {/* Enjeux commune */}
                <div className="controle-subsection">
                  <h3 className="controle-subsection__title">
                    <i className="fa-solid fa-map-marked-alt controle-subsection__icon" />
                    Enjeux liés à la commune
                    <span className="section-title-tags">
                      {selectedCommune && (
                        <span className={`strat-tag ${communeConcernee ? "strat-tag--oui" : "strat-tag--non"}`}>
                          {communeConcernee ? "→ Oui, la commune est concernée" : "→ Non, la commune n'est pas concernée"}
                        </span>
                      )}
                    </span>
                  </h3>
                  <fieldset className="fr-fieldset" aria-label="Motifs de sélection">
                    <div className="fr-fieldset__content motif-grid-2col">
                      {[
                        { key: "ZI", kind: "motif" as const, label: "Zone risque naturel" },
                        { key: "PEB", kind: "motif" as const, label: "Plan d'exposition au bruit" },
                        { key: "RT", kind: "motif" as const, label: "Risques technologiques" },
                        { key: "LLS", kind: "objet" as const, label: "Mixité sociale — logements" },
                        { key: "STEP", kind: "motif" as const, label: "Station d'épuration" },
                      ].map(({ key, kind, label }) => (
                        <MotifItem
                          key={key} itemKey={key} kind={kind}
                          checked={kind === "motif" ? selectedMotifs.includes(key) : selectedObjets.includes(key)}
                          enjeuValue={enjeuValues[key] ?? null}
                          hasError={!!errors[`enjeu_${key}`]}
                          onCheck={checked => {
                            if (kind === "motif") setSelectedMotifs(prev => checked ? [...prev, key] : prev.filter(m => m !== key));
                            else setSelectedObjets(prev => checked ? [...prev, key] : prev.filter(o => o !== key));
                            if (!checked) setEnjeuValues(prev => { const n = { ...prev }; delete n[key]; return n; });
                          }}
                          onEnjeu={v => setEnjeuValues(prev => ({ ...prev, [key]: v }))}
                        >
                          <label className="fr-label motif-item__label motif-item__label--badge" htmlFor={`${kind}-${enjeuId(key)}`}>
                            <span className="motif-badge">{key}</span>{label}
                          </label>
                        </MotifItem>
                      ))}
                    </div>
                  </fieldset>
                </div>

                {/* Enjeux projet */}
                <div className="controle-subsection">
                  <h3 className="controle-subsection__title">
                    <i className="fa-solid fa-file-signature controle-subsection__icon" />
                    Enjeux liés au projet
                    <span className="section-title-tags">
                      {selectedCommune && (
                        <span className={`strat-tag ${projetConcerne ? "strat-tag--oui" : "strat-tag--non"}`}>
                          {projetConcerne ? "→ Oui, le projet est concerné" : "→ Non, le projet n'est pas concerné"}
                        </span>
                      )}
                    </span>
                  </h3>
                  <fieldset className="fr-fieldset" aria-label="Objets d'autorisation">
                    <div className="fr-fieldset__content motif-grid-2col">
                      {[
                        { key: "ZN", kind: "motif" as const, label: "Zone naturelle" },
                        { key: "ERP 1/2/3", kind: "objet" as const, label: "ERP cat. 1 à 3" },
                        { key: "ZA", kind: "motif" as const, label: "Zone agricole" },
                        { key: "ERP 4/5", kind: "objet" as const, label: "ERP cat. 4 et 5" },
                        { key: "EE", kind: "objet" as const, label: "Évaluation environnementale" },
                        { key: "Signalé", kind: "objet" as const },
                        { key: "Site classé", kind: "motif" as const, label: "Dans le périmètre d'un site classé" },
                        { key: "Aléatoire", kind: "objet" as const },
                      ].map(({ key, kind, label }) => (
                        <MotifItem
                          key={key} itemKey={key} kind={kind}
                          checked={kind === "motif" ? selectedMotifs.includes(key) : selectedObjets.includes(key)}
                          enjeuValue={enjeuValues[key] ?? null}
                          hasError={!!errors[`enjeu_${key}`]}
                          onCheck={checked => {
                            if (kind === "motif") setSelectedMotifs(prev => checked ? [...prev, key] : prev.filter(m => m !== key));
                            else setSelectedObjets(prev => checked ? [...prev, key] : prev.filter(o => o !== key));
                            if (!checked) setEnjeuValues(prev => { const n = { ...prev }; delete n[key]; return n; });
                          }}
                          onEnjeu={v => setEnjeuValues(prev => ({ ...prev, [key]: v }))}
                        >
                          <label className="fr-label motif-item__label motif-item__label--badge" htmlFor={`${kind}-${enjeuId(key)}`}>
                            <span className={`motif-badge${key.length > 5 ? " motif-badge--sm" : ""}`}>{key}</span>
                            {label || ""}
                          </label>
                        </MotifItem>
                      ))}

                      {/* Taille item */}
                      <div className={`motif-item${selectedObjets.includes("Taille") ? " is-checked" : ""}`} data-objet="Taille" style={{ gridColumn: 1 }}>
                        <div className="motif-item__checkbox">
                          <input type="checkbox" id="objet-taille" className="objet" value="Taille"
                            checked={selectedObjets.includes("Taille")}
                            onChange={e => setSelectedObjets(prev => e.target.checked ? [...prev, "Taille"] : prev.filter(o => o !== "Taille"))}
                          />
                        </div>
                        <div className="motif-item__content">
                          <label className="fr-label motif-item__label motif-item__label--badge" htmlFor="objet-taille">
                            <span className="motif-badge motif-badge--sm">Taille</span>
                            Taille du projet
                            {selectedCommune && (
                              <span className="taille-seuil-hint">(seuil : ≥ {getSeuilLogements(selectedCommune)} logements)</span>
                            )}
                            <div className="motif-item__taille-input">
                              <input type="number" id="taille-logements" min="0" max="9999"
                                placeholder="0" autoComplete="off"
                                value={tailleLogements}
                                onChange={e => { setTailleLogements(e.target.value); setErrors(p => ({ ...p, taille: "" })); }}
                                style={errors.taille ? { borderColor: "var(--border-plain-error)" } : {}}
                              />
                              <span className="taille-unit">logements</span>
                              {errors.taille && <p className="fr-error-text" style={{ margin: 0 }}>{errors.taille}</p>}
                            </div>
                          </label>
                        </div>
                      </div>
                    </div>
                  </fieldset>
                </div>

              </section>

              {/* Action bar */}
              <div className="actions-band" role="region">
                <div className="actions-inner">
                  <button type="button" className="action-btn action-btn--primary" disabled={busy || !envOk}
                    onClick={handleSave}>
                    {busy
                      ? <><i className="fa-solid fa-spinner fa-spin" /> Enregistrement…</>
                      : <><i className="fa-solid fa-check" /> {mode === "edit" ? "Mettre à jour" : "Créer"}</>
                    }
                  </button>
                  <button type="button" className="action-btn action-btn--secondary" disabled={busy}
                    onClick={() => { resetForm(); setModeState("create"); setCurrentRowId(null); }}>
                    <i className="fa-solid fa-rotate-left" /> Réinitialiser
                  </button>
                  {mode === "edit" && (
                    <button type="button" className="action-btn action-btn--tertiary" disabled={busy}
                      onClick={() => { resetForm(); setModeState("create"); setCurrentRowId(null); }}>
                      Quitter l'édition
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Tab: Dashboard */}
          {tab === "dashboard" && (
            <div>
              {/* Toolbar line 1: commune search */}
              <div className="dashboard-toolbar-line-1">
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem", fontSize: "0.875rem", fontWeight: 600, color: "#333" }}>
                  <i className="fa-solid fa-magnifying-glass" /> COMMUNE
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", width: "100%" }}>
                  <div style={{ flex: 1, position: "relative" }}>
                    <input type="text" className="commune-input"
                      placeholder="Rechercher une commune…" autoComplete="off"
                      style={{ width: "100%", padding: "0.75rem 2.5rem 0.75rem 0.75rem", border: "2px solid #000091", borderRadius: "4px", fontSize: "1rem" }}
                      value={dashCommuneQuery}
                      onChange={e => {
                        setDashCommuneQuery(e.target.value);
                        if (!e.target.value) { setDashSelectedCommune(null); }
                        const items = filterCommunesFromList(communesRef.current, e.target.value);
                        setDashCommuneDdOpen(items.length > 0 && e.target.value.length > 0);
                      }}
                      onBlur={() => setTimeout(() => setDashCommuneDdOpen(false), 150)}
                    />
                    {dashCommuneQuery && (
                      <button type="button" style={{ position: "absolute", right: "0.75rem", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: "1rem" }}
                        onClick={() => { setDashCommuneQuery(""); setDashSelectedCommune(null); setDashCommuneDdOpen(false); }}>
                        <i className="fa-solid fa-xmark" />
                      </button>
                    )}
                    {dashCommuneDdOpen && (
                      <div className="dd-panel" style={{ display: "block" }}>
                        {filterCommunesFromList(communesRef.current, dashCommuneQuery).map(c => (
                          <button key={c.id} type="button" className="dd-item"
                            onMouseDown={() => {
                              setDashSelectedCommune(c);
                              setDashCommuneQuery(c.nom);
                              setDashCommuneDdOpen(false);
                              setDashScope("commune");
                            }}>
                            {c.arr && <span className="type-dd__item-badge dd-arr-badge">{c.arr}</span>}
                            <div className="dd-item-body">
                              <span className="dd-title">{c.nom}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {dashSelectedCommune?.arr && (
                    <span className="tag tag--light" style={{ whiteSpace: "nowrap" }}>{dashSelectedCommune.arr}</span>
                  )}
                </div>
              </div>

              {/* Toolbar line 2: période + scope */}
              <div className="dashboard-toolbar-line-2">
                <div className="dashboard-left-section">
                  <div className="dashboard-toolbar__period">
                    <i className="fa-solid fa-calendar" /> <span>Période:</span>
                  </div>
                  <div className="vue-selector" role="group">
                    {(["mois", "trimestre", "annee"] as const).map(v => (
                      <button key={v} className={`vue-btn ${dashVue === v ? "active" : ""}`} type="button"
                        onClick={() => { setDashVue(v); setDashMonth(new Date().getMonth() + 1); setDashYear(new Date().getFullYear()); }}>
                        {v === "mois" ? "Mois" : v === "trimestre" ? "Trim." : "Année"}
                      </button>
                    ))}
                  </div>
                  <div className="dash-nav">
                    <button className="dash-nav-btn" type="button" onClick={() => navigateDashPeriod(-1)}>
                      <i className="fa-solid fa-chevron-left" />
                    </button>
                    <span className="dash-period-label">{getDashPeriodLabel(dashVue, dashMonth, dashYear)}</span>
                    <button className="dash-nav-btn" type="button" onClick={() => navigateDashPeriod(1)}>
                      <i className="fa-solid fa-chevron-right" />
                    </button>
                  </div>
                </div>
                <div className="dashboard-right-section">
                  <button className={`scope-btn ${dashScope === "commune" ? "active" : ""}`} type="button"
                    onClick={() => { setDashScope("commune"); if (!dashSelectedCommune && communes.length > 0) setDashSelectedCommune(communes[0]); }}>
                    <i className="fa-solid fa-location-dot" /> Commune sélectionnée
                  </button>
                  <button className={`scope-btn ${dashScope === "all" ? "active" : ""}`} type="button"
                    onClick={() => { setDashScope("all"); setDashSelectedCommune(null); setDashCommuneQuery(""); }}>
                    <i className="fa-solid fa-earth-europe" /> Toutes les communes
                  </button>
                </div>
              </div>

              {/* Toolbar line 3: subtabs + filters */}
              <div className="dashboard-toolbar-line-3">
                <div style={{ display: "flex", alignItems: "center", gap: "2rem", width: "100%" }}>
                  <div className="sub-tabs">
                    <button className="sub-tab active" type="button">
                      <i className="fa-solid fa-table" /> Tableau global
                    </button>
                  </div>
                  {filteredRows.length > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                      {Object.entries(filteredRows.reduce<Record<string, number>>((acc, r) => { if (r.type) acc[r.type] = (acc[r.type] || 0) + 1; return acc; }, {}))
                        .map(([type, count]) => <span key={type} className="tag tag--info">{type} : {count}</span>)
                      }
                      <span className="tag tag--light">Total : {filteredRows.length}</span>
                    </div>
                  )}
                  <button type="button" id="btnToggleFilters" className={dashFiltersOpen ? "open" : ""}
                    style={{ marginLeft: "auto", marginRight: "0.75rem" }}
                    onClick={() => setDashFiltersOpen(v => !v)}>
                    <i className="fa-solid fa-filter" />
                    {(dashFilters.arr.length + dashFilters.motif.length + dashFilters.objet.length) > 0 && (
                      <span style={{ display: "inline", background: "#FF6B6B", color: "white", padding: "0.1rem 0.4rem", borderRadius: "12px", fontSize: "0.75rem", fontWeight: 700, marginLeft: "0.25rem" }}>
                        {dashFilters.arr.length + dashFilters.motif.length + dashFilters.objet.length}
                      </span>
                    )}
                    {" "}Filtres
                  </button>
                </div>
              </div>

              {/* Filtres bar */}
              {dashFiltersOpen && (
                <div id="dashFiltersBar" className="open">
                  {uniqueArrs.length > 0 && (
                    <div className="filters-group">
                      <span className="filter-label">Arrondissement :</span>
                      <div className="filter-buttons">
                        {uniqueArrs.map(arr => (
                          <button key={arr} type="button"
                            className={`filter-btn${dashFilters.arr.includes(arr) ? " active" : ""}`}
                            onClick={() => setDashFilters(prev => ({
                              ...prev,
                              arr: prev.arr.includes(arr) ? prev.arr.filter(a => a !== arr) : [...prev.arr, arr],
                            }))}>
                            {arr}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {uniqueMotifs.length > 0 && (
                    <div className="filters-group">
                      <span className="filter-label">Motif :</span>
                      <div className="filter-buttons">
                        {uniqueMotifs.map(m => (
                          <button key={m} type="button"
                            className={`filter-btn${dashFilters.motif.includes(m) ? " active" : ""}`}
                            onClick={() => setDashFilters(prev => ({
                              ...prev,
                              motif: prev.motif.includes(m) ? prev.motif.filter(x => x !== m) : [...prev.motif, m],
                            }))}>
                            {m}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {uniqueObjets.length > 0 && (
                    <div className="filters-group">
                      <span className="filter-label">Objet :</span>
                      <div className="filter-buttons">
                        {uniqueObjets.map(o => (
                          <button key={o} type="button"
                            className={`filter-btn${dashFilters.objet.includes(o) ? " active" : ""}`}
                            onClick={() => setDashFilters(prev => ({
                              ...prev,
                              objet: prev.objet.includes(o) ? prev.objet.filter(x => x !== o) : [...prev.objet, o],
                            }))}>
                            {o}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <button id="btnClearAllFilters" type="button"
                    onClick={() => setDashFilters({ arr: [], motif: [], objet: [], selection: [], reglementation: [] })}>
                    <i className="fa-solid fa-xmark" /> Réinitialiser
                  </button>
                </div>
              )}

              {/* Tableau croisé */}
              {!anpcDataLoaded ? (
                <div style={{ textAlign: "center", padding: "2rem", color: "#999" }}>Chargement…</div>
              ) : filteredRows.length === 0 ? (
                <div style={{ textAlign: "center", padding: "2rem", color: "#999" }}>
                  Aucune donnée pour cette période.
                </div>
              ) : (
                <div className="croise-wrap">
                  <table className="croise-table">
                    <thead>
                      <tr>
                        {[
                          { field: "majcs", label: "MAJCS" },
                          { field: "communeName", label: "Commune" },
                          { field: "nActe", label: "N° Acte" },
                          { field: "nomProjet", label: "Nom du Projet", minWidth: "20rem" },
                          { field: "arr", label: "Arrondissement" },
                          { field: "selection", label: "Logements" },
                          { field: "logements", label: "Actes", num: true },
                          { field: "type", label: "Permis" },
                          { field: "type2", label: "Motif" },
                          { field: "motif", label: "Motif" },
                          { field: "objet", label: "Stratégie" },
                          { field: "reglementation", label: "Réglementation" },
                          { field: "visaMairie", label: "Visa Mairie" },
                          { field: "receptionPref", label: "Date Réception" },
                          { field: "createdByName", label: "Saisi par" },
                        ].map(({ field, label, num, minWidth }) => (
                          <th key={field}
                            className={`sortable${sortField === field ? " active" : ""}${num ? " col-num" : ""}`}
                            style={minWidth ? { minWidth } : undefined}
                            onClick={() => {
                              if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
                              else { setSortField(field); setSortDir("asc"); }
                            }}>
                            {label} <i className={`fa-solid ${sortField === field ? (sortDir === "asc" ? "fa-arrow-up" : "fa-arrow-down") : "fa-arrow-down-up"}`} />
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRows.map((row, idx) => {
                        const motifList = fromGristList(row.motif);
                        const objetList = fromGristList(row.objet);
                        const sels = getRowSelections(row);
                        const commune = row.communeId ? communesByIdRef.current.get(row.communeId) : null;
                        return (
                          <tr key={row.id} className={idx % 2 === 1 ? "alt-row" : ""}>
                            <td><strong>{row.majcs}</strong></td>
                            <td><strong>{row.communeName}</strong></td>
                            <td>{row.nActe}</td>
                            <td>{row.nomProjet}</td>
                            <td>{row.arr ? <span className="tag tag--light">{row.arr}</span> : "—"}</td>
                            <td className="col-num">{row.logements ? <span className="tag tag--light">{row.logements}</span> : "—"}</td>
                            <td>{row.type ? <span className="tag tag--info">{row.type}</span> : "—"}</td>
                            <td>{row.type2 ? <span className="tag tag--info">{row.type2}</span> : "—"}</td>
                            <td className="col-nowrap">
                              {motifList.length > 0 ? motifList.map(m => <span key={m} className="tag tag--info" style={{ marginRight: "0.25rem" }}>{m}</span>) : "—"}
                            </td>
                            <td className="col-nowrap">
                              {objetList.length > 0 ? objetList.map(o => <span key={o} className="tag tag--info" style={{ marginRight: "0.25rem" }}>{o}</span>) : "—"}
                            </td>
                            <td className="col-nowrap">
                              {sels.length > 0 ? sels.map(s => {
                                const cls = s === "Fixe" ? "sel-fixe" : s === "Ciblée" ? "sel-ciblee" : "sel-rotation";
                                return <span key={s} className={`commune-arr-badge commune-arr-badge--sel ${cls}`} style={{ marginRight: "0.25rem" }}>{s}</span>;
                              }) : "—"}
                            </td>
                            <td>{commune?.reglementation ? <span className="tag tag--reglementation">{commune.reglementation}</span> : "—"}</td>
                            <td>{formatDate(row.visaMairie)}</td>
                            <td>{formatDate(row.receptionPref)}</td>
                            <td>{row.createdByName}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
