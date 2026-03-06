# Widget Enregistrement

Formulaire de **saisie des actes d'urbanisme individuels** (table `AN_PC`) avec
tableau de bord d'analyse des actes enregistrés.

C'est le widget le plus technique : il gère une saisie complète avec validation,
des logiques d'enjeux par commune, un système de motifs/objets, et un dashboard filtrable.

---

## Fonctionnalités

### Onglet Saisie
- Recherche commune par nom ou code INSEE (autocomplete avec scoring)
- Affichage des métadonnées de la commune : arrondissement, logements, réglementation, enjeux
- Saisie des champs de l'acte :
  - Type (PC, PA, PD, DP) + Type 2 (Initial, Modificatif, Transfert, Prorogation)
  - N° d'acte, N° de parcelle, Nom du projet
  - Date visa mairie + date réception préfecture
  - Trimestre (calculé automatiquement depuis la date)
  - Origine (défaut : @CTES)
  - MAJCS (Mise à jour du contrôle en section)
- Section **Contrôle de légalité** : enjeux liés à la commune et au projet
  - Cases à cocher pour chaque enjeu avec radio Oui/Non
  - ERP 4/5 et Taille : valeur "Oui" automatique (pas de radio affiché)
- Seuil logements : affiché selon l'arrondissement (100 / 75 / 20 / 10)
- Indicateurs automatiques : "Oui, la commune est concernée" / "Non, le projet n'est pas concerné"
- Création via `AddRecord` dans `AN_PC`

### Onglet Tableau de bord
- Liste des actes de la période sélectionnée avec barre de filtres :
  - **Arrondissement**, **Stratégie**, **Logements**, **Acte**, **Permis**,
    **Enjeux**, **Motifs**, **Réglementation**, **Saisi par**
- Compteurs en haut à droite : PC / PD / Total
- Recherche par commune
- Tri sur chaque colonne (clic sur l'en-tête)
- Scrollbar miroir au-dessus du tableau (synchronisée)

---

## Tables Grist

| Table | Accès | Colonnes clés |
|-------|-------|---------------|
| `Communes` | Lecture | `Nom commune`, `Code INSEE`, `Arrondissement`, `Logements`, `Enjeux`, `Hors_ZI`, `Reglementation` |
| `Communes_Statut` | Lecture | `Commune` (Ref), `Selection` (ChoiceList), `Debut`, `Fin` |
| `AN_PC` | Lecture + Écriture | Voir section Colonnes AN_PC ci-dessous |

---

## Colonnes `AN_PC` (`COLS`)

| Clé interne | Colonne Grist | Description |
|-------------|---------------|-------------|
| `Type` | `Type` | Type d'acte : PC, PA, PD, DP |
| `Type2` | `Type2` | Sous-type : I (Initial), M (Modificatif), T (Transfert), P (Prorogation) |
| `Mois` | `Mois` | Mois de la date visa mairie |
| `Annee` | `Annee` | Année |
| `NoActe` | `N_ACTE` | Numéro de l'acte |
| `NParcelle` | `N_Parcelle` | Numéro de parcelle |
| `NomProjet` | `Nom_du_projet` | Désignation du projet |
| `VisaMairie` | `Visa_Mairie` | Date visa mairie |
| `ReceptionPref` | `Reception_Pref` | Date réception préfecture |
| `Origine` | `Origine` | Source : @CTES, Courrier… |
| `Enjeux` | `Enjeux_pre_identifies` | Enjeux sélectionnés (ChoiceList) |
| `MotifsControle` | `Motifs_controle` | Motifs de contrôle sélectionnés |
| `EnjeuOld` | `O_Concerne_par_l_enjeu` | **Legacy** — colonne pré-refactor, lecture seule |
| `EnjeuPrefix` | `Enjeu_` | Préfixe des colonnes enjeu individuelles |
| `Controle` | `Controle` | Boolean : dossier contrôlé ou non |
| `RaisonControle` | `P_Raison_du_controle_ou_non_controle` | Raison si non contrôlé |
| `MAJCS` | `MAJCS` | Mise à jour contrôle en section |
| `Trimestre` | `Trimestre` | Format `YYYY-TN` (calculé auto depuis date réception préf.) |
| `SelectionSnapshot` | `Selection_commune_au_moment` | Sélection de la commune au moment de la saisie |
| `CommuneRef` | `Communes` | Référence Grist vers la commune |
| `TailleLogements` | `Taille_logements` | Nombre de logements saisi pour l'enjeu Taille |

---

## Enjeux liés à la commune (`ALL_MOTIFS`)

`ZI`, `ZA`, `ZN`, `RT`, `STEP`, `PEB`, `Site classé`

Chaque enjeu a une colonne dans `AN_PC` préfixée `Enjeu_` (ex: `Enjeu_ZI`, `Enjeu_RT`).
Le mapping code → nom de colonne est géré par `MOTIF_TO_COL` (seule exception : `Site classé` → `Classe`).

## Motifs de contrôle — enjeux liés au projet (`ALL_OBJETS`)

`LLS`, `ERP 1/2/3`, `ERP 4/5`, `EE`, `Signalé`, `Aléatoire`, `Taille`

Le mapping clé → nom de colonne est géré par `OBJET_TO_COL`.

Les items **`ERP 4/5`** et **`Taille`** sont dans `INDOLORES` : leur valeur est automatiquement
"Oui" quand la case est cochée, sans radio Oui/Non à afficher.

---

## Logique de seuil logements (`getSeuilLogements`)

Le seuil de l'enjeu **Taille** dépend de l'arrondissement :

| Arrondissement | Commune Toulouse | Autres communes |
|----------------|-----------------|-----------------|
| Toulouse       | 100             | 75              |
| Muret          | —               | 20              |
| Saint-Gaudens  | —               | 10              |

---

## Recherche commune (`scoreCommune`)

Le scoring de pertinence pour l'autocomplete fonctionne différemment selon
que la requête ressemble à un code INSEE (chiffres uniquement) ou à un nom :

**Recherche par nom :**
```
score 0 → nom exact
score 1 → nom commence par la requête
score 2 → nom contient la requête
score 3 → INSEE commence par les chiffres
score 4 → INSEE contient les chiffres
score 99 → pas de match → exclu
```

**Recherche par INSEE :**
```
score 0 → INSEE exact
score 1 → INSEE commence par la requête
score 2 → nom commence par la requête
score 3 → nom contient la requête
score 4 → INSEE contient la requête
score 99 → pas de match → exclu
```

Maximum `MAX_COMMUNE_RESULTS` (25) résultats retournés.

---

## Composants internes

| Composant | Description |
|-----------|-------------|
| `TypeDropdown` | Dropdown accessible (aria) pour sélectionner un type d'acte ou sous-type |
| `MotifItem` | Case à cocher + radio Oui/Non pour un enjeu commune ou projet |
| `ToastContainer` | Affiche les notifications (succès, erreur, avertissement, info) |

---

## État React principal

| State | Type | Description |
|-------|------|-------------|
| `communes` | `Commune[]` | Liste complète des communes |
| `communesByNom/ByInsee/ById` | `Map` | Index pour la résolution des références |
| `selectedCommune` | `Commune \| null` | Commune active |
| `statutsByKey` | `Map<string, Statut>` | Statuts indexés par `communeId\|trimestre` |
| `selectedMotifs` | `Set<string>` | Enjeux commune cochés |
| `selectedObjets` | `Set<string>` | Enjeux projet cochés |
| `enjeuValues` | `Map<string, "Oui"\|"Non">` | Valeur Oui/Non par enjeu coché |
| `tab` | `"saisie" \| "dashboard"` | Onglet actif |
| `allAnpcRows` | `AnpcRow[]` | Tous les actes AN_PC pour le dashboard |
| `dashFilters` | `DashFilters` | Filtres actifs dans le dashboard |

### Interface `DashFilters`

```ts
interface DashFilters {
  arr: string[];           // Arrondissements
  selection: string[];     // Stratégie (Fixe / Rotation / Ciblée)
  logements: string[];     // Seuil logements (10+ / 20+ / 75+ / 100+)
  type: string[];          // Type d'acte (PC, PD, PA, DP)
  type2: string[];         // Type de permis (I, M, T, P)
  motif: string[];         // Enjeux commune (ZI, ZA, ZN, RT, STEP, PEB, Site classé)
  objet: string[];         // Motifs projet (LLS, ERP 1/2/3, ERP 4/5, EE…)
  reglementation: string[];// Réglementation applicable
  createdByName: string[]; // Agent ayant saisi l'acte
}
```

### Colonnes du tableau de bord

| Colonne | Source |
|---------|--------|
| MAJCS | `AN_PC.MAJCS` |
| Commune | Lookup via `communesByIdRef` |
| N° acte | `AN_PC.N_ACTE` |
| Nom du projet | `AN_PC.Nom_du_projet` |
| Arrondissement | Lookup via commune |
| **Stratégie** | Calculé depuis `statutsByKey` au moment de la saisie |
| **Logements** | Seuil de la commune (ex: "75+") |
| **Acte** | `AN_PC.Type` |
| **Permis** | `AN_PC.Type2` |
| Enjeux | `AN_PC.Enjeux_pre_identifies` |
| Motifs | `AN_PC.Motifs_controle` |
| Réglementation | Lookup via commune |
| Réception préf. | `AN_PC.Reception_Pref` |
| Visa mairie | `AN_PC.Visa_Mairie` |
| Saisi par | `AN_PC.createdByName` |
| Saisi le | `AN_PC.createdAt` |

---

## Flux de sauvegarde

```
handleSave()
    │
    ├─ Validation (9 contrôles) :
    │   - Type, Type2, Visa mairie, Réception préf. requis
    │   - Commune sélectionnée
    │   - Origine requise
    │   - Chaque enjeu coché doit avoir une valeur Oui/Non (sauf INDOLORES)
    │   - Enjeu Taille : nombre de logements requis si coché
    │   - N° ACTE : unicité vérifiée dans l'index local
    │
    ├─ Construit le record à écrire :
    │   - Champs de base (type, dates, n°, etc.)
    │   - Trimestre calculé depuis la date réception préf.
    │   - Selection snapshot depuis statutsByKey
    │   - Enjeux : colonnes Enjeu_X = "Oui"/"Non"/null selon les cases cochées
    │
    └─ applyUserActions([["AddRecord", "AN_PC", null, fields]])
```

---

## Utilitaires purs

| Fonction | Description |
|----------|-------------|
| `norm(s)` | Normalise une chaîne (minuscules, sans accents, underscores) |
| `pickCol(table, candidates)` | Trouve une colonne par nom exact puis par nom normalisé |
| `toGristList / fromGristList` | Encode/décode le format liste Grist `["L", ...]` |
| `parseDate(v)` | Parse une date depuis Unix secondes, string ISO ou string `DD/MM/YYYY` |
| `computeTrimestreFromDate` | Calcule `"YYYY-TN"` depuis une date ISO |
| `getStatutSelection` | Retourne la sélection active d'une commune à une date donnée |
| `getSeuilLogements` | Seuil logements selon l'arrondissement |
| `selectionHasAny` | Vérifie si une liste de sélections contient l'un des tags voulus |
| `debounce(fn, delay)` | Debounce (utilisé pour l'autocomplete commune) |
| `enjeuColForItem(item)` | Retourne le nom de colonne Grist pour un motif/objet (ex: `Enjeu_ERP123`) |
| `scoreCommune(c, q, qNorm)` | Score de pertinence pour l'autocomplete |
| `filterCommunesFromList` | Filtre et trie les communes selon la requête |
