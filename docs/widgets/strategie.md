# Widget Stratégie

Visualisation des **statuts de contrôle des communes** sur une période donnée.
Permet de savoir quelles communes sont en contrôle Fixe, Rotation ou Ciblée
et pendant quelle période.

Widget en **lecture seule** — les données sont alimentées par le référent stratégie DDT 31.

---

## Fonctionnalités

- Sélection de la période : **Mois / Trimestre / Année** avec navigation ←/→
- Filtres multi-sélection :
  - **Tags** : Fixe, Rotation, Ciblée (cochés/décochés individuellement)
  - **Arrondissements** : Toulouse, Muret, Saint-Gaudens (multi-sélection)
- Tri du tableau : par **commune** (A→Z) ou par **période de début** (chronologique)
- Compteur de communes visibles (en haut à droite)
- Toasts de notification en cas d'erreur de chargement

---

## Tables Grist

| Table | Accès | Colonnes clés |
|-------|-------|---------------|
| `Communes` | Lecture | `Nom commune`, `Arrondissement` |
| `Communes_Statut` | Lecture | `Commune` (Ref), `Selection` (ChoiceList), `Debut` (date), `Fin` (date), `Explications` |

---

## Logique de filtrage par période

Une ligne `Communes_Statut` est visible si elle **chevauche** la période affichée :

```
Période affichée :  [start ─────────────────── end]
Ligne incluse si :  row.debut <= end  ET  row.fin >= start

Cas particuliers :
  - row.debut = null → pas de borne de début (toujours "en cours" depuis avant)
  - row.fin = null   → pas de borne de fin (encore actif)
```

Combiné avec :
- filtre `tagFilters` : au moins un tag de la ligne doit être dans l'ensemble actif
- filtre `arrFilters` : l'arrondissement de la commune doit être sélectionné

---

## État React

| State | Type | Description |
|-------|------|-------------|
| `communes` | `Map<number, Commune>` | Référentiel communes (id → { nom, arr }) |
| `statuts` | `StatutRow[]` | Toutes les lignes Communes_Statut |
| `arrondissements` | `string[]` | Liste triée des arrondissements disponibles |
| `vue` | `"mois" \| "trimestre" \| "annee"` | Granularité de la période |
| `year` / `month` | `number` | Période courante |
| `tagFilters` | `Set<string>` | Tags actifs (Fixe, Rotation, Ciblée) |
| `arrFilters` | `Set<string>` | Arrondissements actifs |
| `sortBy` | `"periode" \| "commune"` | Critère de tri du tableau |

### Type `StatutRow`

```ts
type StatutRow = {
  id: number;
  communeId: number;
  selection: string[];   // ex: ["Fixe"], ["Rotation", "Ciblée"]
  debut: Date | null;
  fin: Date | null;
  explications: string;
  createdByName: string; // agent ayant saisi la ligne (colonne "Saisi par")
};
```

---

## Helpers de période

| Fonction | Description |
|----------|-------------|
| `periodBounds(vue, year, month)` | Calcule les dates start/end de la période affichée |
| `periodLabel(vue, year, month)` | Libellé affiché (ex: "T1 2026", "Février 2026", "Année 2026") |
| `navigatePeriod(dir)` | Avance (+1) ou recule (-1) d'une unité de période |
| `rowPeriodeLabel(row)` | Trimestre du début de la ligne (ex: "T1 2026") |
| `moisLabel(m, a)` | Libellé mois/année formaté en français |

---

## Chips de sélection

| Valeur | Classe CSS |
|--------|-----------|
| `Fixe` | `statut-chip--fixe` |
| `Ciblée` | `statut-chip--ciblee` |
| `Rotation` | `statut-chip--rotation` |
| Autre | `statut-chip--nonciblee` |

Une commune peut avoir plusieurs chips si elle apparaît dans plusieurs critères de sélection
(ex: Ciblée + Fixe simultanément).

---

## Ordre des arrondissements

L'ordre d'affichage des boutons d'arrondissement est imposé par `ARR_ORDER` :
```ts
const ARR_ORDER = ["Toulouse", "Muret", "Saint-Gaudens"];
```
Les arrondissements inconnus (hors liste) sont triés alphabétiquement après les trois ci-dessus.
