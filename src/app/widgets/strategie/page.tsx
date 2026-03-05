"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useGristInit } from "@/lib/grist/hooks";
import type { GristDocAPI } from "@/lib/grist/meta";

/* ══════════════════════════════════════
   CONFIG
══════════════════════════════════════ */
const TABLE_STATUT   = "Communes_Statut";
const TABLE_COMMUNES = "Communes";

const COM = { Nom: "Nom commune", INSEE: "Code INSEE", ARR: "Arrondissement" };

const STAT_COLS = {
  Commune:      "Commune",
  Selection:    "Selection",
  Debut:        "Debut",
  Fin:          "Fin",
  Explications: "Explications",
};

const MONTHS_FR = [
  "Janvier","Février","Mars","Avril","Mai","Juin",
  "Juillet","Août","Septembre","Octobre","Novembre","Décembre",
];

const TAGS_FILTRES = ["Fixe", "Rotation", "Ciblée"] as const;

// Ordre imposé pour l'affichage des arrondissements
const ARR_ORDER = ["Toulouse", "Muret", "Saint-Gaudens"];

/* ══════════════════════════════════════
   TYPES
══════════════════════════════════════ */
type Commune  = { id: number; nom: string; arr: string; };
type StatutRow = {
  id: number;
  communeId: number;
  selection: string[];
  debut: Date | null;
  fin: Date | null;
  explications: string;
  createdByName: string;
};
type VueType = "mois" | "trimestre" | "annee";
type Toast   = { id: string; kind: "success"|"error"|"info"|"warning"; title: string; desc?: string; closing?: boolean; };

/* ══════════════════════════════════════
   HELPERS
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
  if (Array.isArray(v))
    return v.filter(x => x !== "L" && x != null && x !== "").map(x => x.toString().trim()).filter(Boolean);
  const s = (v ?? "").toString().trim();
  return s ? [s] : [];
}

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function moisLabel(m: number, a: number): string {
  return `${MONTHS_FR[(m || 1) - 1]} ${a}`;
}

function periodBounds(vue: VueType, year: number, month: number): { start: Date; end: Date } {
  if (vue === "mois") {
    return {
      start: new Date(year, month - 1, 1),
      end:   new Date(year, month, 0, 23, 59, 59),
    };
  }
  if (vue === "trimestre") {
    const t = Math.floor((month - 1) / 3) + 1;
    const mStart = (t - 1) * 3 + 1;
    return {
      start: new Date(year, mStart - 1, 1),
      end:   new Date(year, mStart + 2, 0, 23, 59, 59),
    };
  }
  return {
    start: new Date(year, 0, 1),
    end:   new Date(year, 11, 31, 23, 59, 59),
  };
}

function periodLabel(vue: VueType, year: number, month: number): string {
  if (vue === "mois") return moisLabel(month, year);
  if (vue === "trimestre") {
    const t = Math.floor((month - 1) / 3) + 1;
    return `T${t} ${year}`;
  }
  return `Année ${year}`;
}

/* ══════════════════════════════════════
   COMPOSANT PRINCIPAL
══════════════════════════════════════ */
export default function StrategiePage() {
  const { docApi, gristUser } = useGristInit({ requiredAccess: "read table" });
  const docApiRef  = useRef<GristDocAPI | null>(null);

  // ── State ──
  const [communes,       setCommunes]       = useState<Map<number, Commune>>(new Map());
  const [statuts,        setStatuts]        = useState<StatutRow[]>([]);
  const [arrondissements,setArrondissements]= useState<string[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [vue,            setVue]            = useState<VueType>("trimestre");
  const [year,           setYear]           = useState(() => new Date().getFullYear());
  const [month,          setMonth]          = useState(() => new Date().getMonth() + 1);
  const [tagFilters,     setTagFilters]     = useState<Set<string>>(new Set(TAGS_FILTRES));
  const [arrFilters,     setArrFilters]     = useState<Set<string>>(new Set());
  const [sortBy,         setSortBy]         = useState<"periode" | "commune">("periode");
  const [toasts,         setToasts]         = useState<Toast[]>([]);

  // ── Refs ──
  useEffect(() => { docApiRef.current = docApi; }, [docApi]);

  // ── Toast helpers ──
  let toastCounter = 0;
  const showToast = useCallback((kind: Toast["kind"], title: string, desc?: string, duration = 4000) => {
    const id = `toast-${Date.now()}-${++toastCounter}`;
    setToasts(prev => [...prev, { id, kind, title, desc }]);
    if (kind !== "error" && duration > 0) {
      setTimeout(() => closeToast(id), duration);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeToast = useCallback((id: string) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, closing: true } : t));
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 300);
  }, []);

  // ── Chargement des données ──
  useEffect(() => {
    if (!docApi) return;
    loadData(docApi);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docApi]);

  async function loadData(api: GristDocAPI) {
    setLoading(true);
    try {
      // Table Communes
      const comTable = await api.fetchTable(TABLE_COMMUNES);
      const nomCol = pickCol(comTable as Record<string, unknown>, [COM.Nom, "Nom", "nom", "NomCommune"]);
      const arrCol = pickCol(comTable as Record<string, unknown>, [COM.ARR, "Arrondissement", "ARR", "arr"]);
      const comIds = (comTable as Record<string, number[]>).id || [];
      const comMap = new Map<number, Commune>();
      comIds.forEach((id: number, i: number) => {
        comMap.set(id, {
          id,
          nom: nomCol ? String((comTable as Record<string, unknown[]>)[nomCol][i] ?? "") : `Commune ${id}`,
          arr: arrCol ? String((comTable as Record<string, unknown[]>)[arrCol][i] ?? "") : "",
        });
      });
      setCommunes(comMap);

      // Calcule la liste triée des arrondissements uniques (ordre imposé)
      const arrSet = new Set<string>();
      comMap.forEach(c => { if (c.arr) arrSet.add(c.arr); });
      const arrList = Array.from(arrSet).sort((a, b) => {
        const ia = ARR_ORDER.indexOf(a);
        const ib = ARR_ORDER.indexOf(b);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return a.localeCompare(b, "fr", { numeric: true });
      });
      setArrondissements(arrList);
      setArrFilters(new Set(arrList)); // tous cochés par défaut

      // Table Communes_Statut
      const statTable = await api.fetchTable(TABLE_STATUT);
      const comColS = pickCol(statTable as Record<string, unknown>, [STAT_COLS.Commune, "Commune", "commune"]);
      const selCol  = pickCol(statTable as Record<string, unknown>, [STAT_COLS.Selection, "Selection", "selection"]);
      const debCol  = pickCol(statTable as Record<string, unknown>, [STAT_COLS.Debut, "Debut", "debut"]);
      const finCol  = pickCol(statTable as Record<string, unknown>, [STAT_COLS.Fin, "Fin", "fin"]);
      const expCol       = pickCol(statTable as Record<string, unknown>, [STAT_COLS.Explications, "Explications", "explications"]);
      const createdByCol = pickCol(statTable as Record<string, unknown>, ["CreatedByName"]);

      const sIds = (statTable as Record<string, number[]>).id || [];
      const rows: StatutRow[] = sIds.map((id: number, i: number) => ({
        id,
        communeId:    comColS ? Number((statTable as Record<string, unknown[]>)[comColS][i] ?? 0) : 0,
        selection:    selCol  ? cleanSelection((statTable as Record<string, unknown[]>)[selCol][i])    : [],
        debut:        debCol  ? parseDate((statTable as Record<string, unknown[]>)[debCol][i])         : null,
        fin:          finCol  ? parseDate((statTable as Record<string, unknown[]>)[finCol][i])         : null,
        explications: expCol  ? String((statTable as Record<string, unknown[]>)[expCol][i] ?? "")     : "",
        createdByName: createdByCol ? String((statTable as Record<string, unknown[]>)[createdByCol][i] ?? "") : "",
      }));
      setStatuts(rows);
    } catch (e) {
      showToast("error", "Erreur de chargement", String(e));
    } finally {
      setLoading(false);
    }
  }

  // ── Navigation période ──
  function navigatePeriod(dir: number) {
    if (vue === "mois") {
      let m = month + dir, y = year;
      if (m < 1)  { m += 12; y--; }
      if (m > 12) { m -= 12; y++; }
      setMonth(m); setYear(y);
    } else if (vue === "trimestre") {
      const t  = Math.floor((month - 1) / 3) + 1;
      let t2 = t + dir, y = year;
      if (t2 < 1) { t2 = 4; y--; }
      if (t2 > 4) { t2 = 1; y++; }
      setMonth((t2 - 1) * 3 + 1); setYear(y);
    } else {
      setYear(y => y + dir);
    }
  }

  // ── Filtrage ──
  function filteredStatuts(): StatutRow[] {
    const { start, end } = periodBounds(vue, year, month);
    return statuts.filter(row => {
      // Chevauchement de période
      const debutOk = !row.debut || row.debut <= end;
      const finOk   = !row.fin   || row.fin   >= start;
      if (!debutOk || !finOk) return false;
      // Filtre tags
      if (tagFilters.size === 0) return false;
      if (!row.selection.some(s => tagFilters.has(s))) return false;
      // Filtre arrondissement
      if (arrFilters.size > 0 && arrondissements.length > 0) {
        const arr = communes.get(row.communeId)?.arr || "";
        if (!arrFilters.has(arr)) return false;
      }
      return true;
    });
  }

  // ── Toggles filtres ──
  function toggleTag(tag: string) {
    setTagFilters(prev => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag); else next.add(tag);
      return next;
    });
  }

  function toggleArr(arr: string) {
    setArrFilters(prev => {
      const next = new Set(prev);
      if (next.has(arr)) next.delete(arr); else next.add(arr);
      return next;
    });
  }

  // ── Période d'une ligne (trimestre du début) ──
  function rowPeriodeLabel(row: StatutRow): string {
    if (!row.debut) return "";
    const t = Math.floor(row.debut.getMonth() / 3) + 1;
    return `T${t} ${row.debut.getFullYear()}`;
  }

  function rowPeriodeSortKey(row: StatutRow): number {
    return row.debut ? row.debut.getTime() : Infinity;
  }

  function sortedRows(filtered: StatutRow[]): StatutRow[] {
    return [...filtered].sort((a, b) => {
      if (sortBy === "commune") {
        const na = communes.get(a.communeId)?.nom || "";
        const nb = communes.get(b.communeId)?.nom || "";
        return na.localeCompare(nb, "fr");
      }
      // tri par période de début, puis commune
      const diff = rowPeriodeSortKey(a) - rowPeriodeSortKey(b);
      if (diff !== 0) return diff;
      const na = communes.get(a.communeId)?.nom || "";
      const nb = communes.get(b.communeId)?.nom || "";
      return na.localeCompare(nb, "fr");
    });
  }

  // ── Classes CSS ──
  function selChipClass(s: string): string {
    if (s === "Fixe")     return "statut-chip statut-chip--fixe";
    if (s === "Ciblée")   return "statut-chip statut-chip--ciblee";
    if (s === "Rotation") return "statut-chip statut-chip--rotation";
    return "statut-chip statut-chip--nonciblee";
  }

  function tagBtnClass(tag: string, active: boolean): string {
    const color = tag === "Fixe" ? "tag-filter-btn--fixe" : tag === "Ciblée" ? "tag-filter-btn--ciblee" : "tag-filter-btn--rotation";
    return `tag-filter-btn ${color}${active ? " active" : ""}`;
  }

  const label = periodLabel(vue, year, month);
  const rows  = sortedRows(filteredStatuts());

  /* ── Render ── */
  return (
    <div className="app-shell">
      <div className="app-main">

        {/* ── Header ── */}
        <header className="app-header">
          <div className="app-header__logo">
            <i className="fa-solid fa-landmark" />DDT 31
          </div>
          <div className="app-header__title">
            Stratégie
            {gristUser && <span className="app-header__title-user">{gristUser.name}</span>}
          </div>
        </header>

        {/* ── Content ── */}
        <div className="app-content">

          {/* Toolbar */}
          <div className="dashboard-toolbar">

            {/* Ligne 1 : période */}
            <div className="toolbar-row">
              <span className="dashboard-toolbar__period">Période&nbsp;:</span>

              <div className="dash-nav">
                <button className="dash-nav-btn" type="button" aria-label="Période précédente"
                  onClick={() => navigatePeriod(-1)}>
                  <i className="fa-solid fa-chevron-left" />
                </button>
                <span className="dash-period-label">{label}</span>
                <button className="dash-nav-btn" type="button" aria-label="Période suivante"
                  onClick={() => navigatePeriod(1)}>
                  <i className="fa-solid fa-chevron-right" />
                </button>
              </div>

              <div className="vue-selector">
                {(["mois", "trimestre", "annee"] as VueType[]).map(v => (
                  <button key={v} type="button"
                    className={`vue-btn${vue === v ? " active" : ""}`}
                    onClick={() => setVue(v)}>
                    {v === "mois" ? "Mois" : v === "trimestre" ? "Trimestre" : "Année"}
                  </button>
                ))}
              </div>

              {/* Compteur */}
              {!loading && (
                <span className="strat-count">
                  <strong>{rows.length}</strong> commune{rows.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>

            {/* Ligne 2 : filtres */}
            <div className="toolbar-row toolbar-row--filters">
              {/* Filtre tags */}
              <div className="tag-filter-bar">
                {TAGS_FILTRES.map(tag => (
                  <button key={tag} type="button"
                    className={tagBtnClass(tag, tagFilters.has(tag))}
                    onClick={() => toggleTag(tag)}>
                    {tagFilters.has(tag)
                      ? <i className="fa-solid fa-check" />
                      : <i className="fa-solid fa-xmark" style={{ opacity: 0.5 }} />}
                    {tag}
                  </button>
                ))}
              </div>

              {/* Séparateur */}
              {arrondissements.length > 0 && (
                <span style={{ width: 1, background: "#e0e0e0", alignSelf: "stretch", flexShrink: 0 }} />
              )}

              {/* Filtre arrondissements */}
              {arrondissements.length > 0 && (
                <div className="tag-filter-bar">
                  {arrondissements.map(arr => {
                    const active = arrFilters.has(arr);
                    return (
                      <button key={arr} type="button"
                        className={`tag-filter-btn arr-filter-btn${active ? " active" : ""}`}
                        onClick={() => toggleArr(arr)}>
                        {active
                          ? <i className="fa-solid fa-check" />
                          : <i className="fa-solid fa-xmark" style={{ opacity: 0.5 }} />}
                        {arr}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

          </div>

          {/* Tableau */}
          {loading ? (
            <div className="loading-spinner">
              <i className="fa-solid fa-spinner fa-spin" />
              Chargement…
            </div>
          ) : rows.length === 0 ? (
            <div className="no-data">
              <i className="fa-solid fa-filter" />
              <h2>Aucune donnée</h2>
              <p>Aucun statut de commune ne correspond aux filtres sélectionnés pour cette période.</p>
            </div>
          ) : (
            <div className="strat-table-wrap">
              <table className="strat-table">
                <thead>
                  <tr>
                    <th
                      className={`strat-th-sortable${sortBy === "commune" ? " strat-th-sorted" : ""}`}
                      onClick={() => setSortBy(s => s === "commune" ? "periode" : "commune")}
                      title="Cliquer pour trier par commune"
                    >
                      Commune{" "}
                      <i className={`fa-solid ${sortBy === "commune" ? "fa-arrow-up-a-z" : "fa-sort"}`}
                        style={{ fontSize: "0.6rem", opacity: 0.55, marginLeft: "0.15rem" }} />
                    </th>
                    <th>Arrondissement</th>
                    <th>Sélection</th>
                    <th>Début</th>
                    <th>Fin</th>
                    <th
                      className={`strat-th-sortable${sortBy === "periode" ? " strat-th-sorted" : ""}`}
                      onClick={() => setSortBy("periode")}
                      title="Cliquer pour trier par période"
                    >
                      Période{" "}
                      <i className={`fa-solid ${sortBy === "periode" ? "fa-arrow-up-1-9" : "fa-sort"}`}
                        style={{ fontSize: "0.6rem", opacity: 0.55, marginLeft: "0.15rem" }} />
                    </th>
                    <th>Explications</th>
                    <th>Saisi par</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => {
                    const commune = communes.get(row.communeId);
                    const periodeLabel = rowPeriodeLabel(row);
                    return (
                      <tr key={row.id}>
                        <td className="strat-td-commune">
                          {commune?.nom || `#${row.communeId}`}
                        </td>
                        <td className="strat-td-arr">
                          {commune?.arr || "—"}
                        </td>
                        <td>
                          <div className="strat-td-sel">
                            {row.selection.length > 0
                              ? row.selection.map(s => (
                                  <span key={s} className={selChipClass(s)}>{s}</span>
                                ))
                              : <span style={{ color: "#bbb", fontStyle: "italic", fontSize: "0.75rem" }}>—</span>
                            }
                          </div>
                        </td>
                        <td className="strat-td-date">{formatDate(row.debut)}</td>
                        <td className="strat-td-date">{formatDate(row.fin)}</td>
                        <td className="strat-td-periode">
                          {periodeLabel
                            ? <span className="period-chip">{periodeLabel}</span>
                            : <span style={{ color: "#bbb" }}>—</span>}
                        </td>
                        <td className="strat-td-expl">{row.explications || ""}</td>
                        <td className="strat-td-created">{row.createdByName || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

        </div>
      </div>

      {/* Toasts */}
      <div className="toast-container" aria-live="polite" aria-atomic="false">
        {toasts.map(t => {
          const iconMap: Record<string, string> = {
            success: "fa-circle-check",
            error:   "fa-circle-xmark",
            info:    "fa-circle-info",
            warning: "fa-triangle-exclamation",
          };
          return (
            <div key={t.id} className={`toast toast--${t.kind}${t.closing ? " toast--closing" : ""}`}>
              <div className="toast__icon"><i className={`fa-solid ${iconMap[t.kind]}`} /></div>
              <div className="toast__content">
                <div className="toast__title">{t.title}</div>
                {t.desc && <div className="toast__message">{t.desc}</div>}
              </div>
              <button className="toast__close" type="button" aria-label="Fermer"
                onClick={() => closeToast(t.id)}>
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
