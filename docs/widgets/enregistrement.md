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
- Section **Enjeux pré-identifiés** : cases à cocher pour chaque motif/objet avec radio Oui/Non
- Seuil logements : affiché selon l'arrondissement (100/75/20/10)
- Bouton Contrôle / Non contrôle (avec raison si non contrôle)
- Création via `AddRecord` dans `AN_PC`

### Onglet Tableau de bord
- Liste des actes du trimestre sélectionné avec filtres :
  - Arrondissement, Motif, Objet, Sélection commune, Réglementation
- Compteurs par catégorie
- Export possible (si implémenté)

---

## Tables Grist

| Table | Accès | Colonnes clés |
|-------|-------|---------------|
| `Communes` | Lecture | `Nom commune`, `Code INSEE`, `Arrondissement`, `Logements`, `Enjeux`, `Hors_ZI` |
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
| `Controle` | `Controle` | Boolean : dossier contrôlé ou non |
| `RaisonControle` | `P_Raison_du_controle_ou_non_controle` | Raison si non contrôlé |
| `MAJCS` | `MAJCS` | Mise à jour contrôle en section |
| `Trimestre` | `Trimestre` | Format `YYYY-TN` (calculé auto) |
| `SelectionSnapshot` | `Selection_commune_au_moment` | Sélection de la commune au moment de la saisie |
| `CommuneRef` | `Communes` | Référence Grist vers la commune |

---

## Motifs et Objets

### Motifs de contrôle (`ALL_MOTIFS`)
`ZI`, `RT`, `ZA`, `ZN`, `STEP`, `PEB`, `Site classé`

### Objets de contrôle (`ALL_OBJETS`)
`ERP 1/2/3`, `ERP 4/5`, `EE`, `LLS`, `Signalé`, `Aléatoire`, `Taille`

Chaque motif/objet a une colonne dans `AN_PC` préfixée `Enjeu_` (ex: `Enjeu_ZI`, `Enjeu_ERP123`).
Le mapping clé → nom de colonne est géré par `OBJET_TO_COL` et `MOTIF_TO_COL`.

Les items `ERP 4/5` et `Taille` sont **indolores** (pas de radio Oui/Non).

---

## Logique de seuil logements

Le seuil de contrôle dépend de l'arrondissement de la commune :

| Arrondissement | Commune Toulouse | Autres |
|---------------|-----------------|--------|
| Toulouse | 100 | 75 |
| Muret | — | 20 |
| Saint-Gaudens | — | 10 |
| Autres | — | 75 |

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

---

## Composants internes

| Composant | Description |
|-----------|-------------|
| `TypeDropdown` | Dropdown accessible (aria) pour sélectionner un type d'acte ou sous-type |
| `MotifItem` | Case à cocher + radio Oui/Non pour un motif ou objet d'enjeu |
| `ToastContainer` | Affiche les notifications (succès, erreur, avertissement, info) |

---

## État React principal

| State | Type | Description |
|-------|------|-------------|
| `communes` | `Commune[]` | Liste complète des communes |
| `communesByNom/ByInsee` | `Map` | Index pour la résolution des références |
| `selectedCommune` | `Commune \| null` | Commune active |
| `statutsByKey` | `Map<string, Statut>` | Statuts indexés par `communeId\|trimestre` |
| `formData` | `object` | Valeurs du formulaire de saisie |
| `checkedMotifs/Objets` | `Set<string>` | Motifs/objets cochés |
| `enjeuValues` | `Map<string, "Oui"\|"Non">` | Valeur Oui/Non par enjeu coché |
| `tab` | `"saisie" \| "dashboard"` | Onglet actif |
| `dashFilters` | `DashFilters` | Filtres actifs dans le dashboard |

---

## Flux de sauvegarde

```
handleSave()
    │
    ├─ Validation : commune requise, type requis, motifs avec valeurs Oui/Non
    │
    ├─ Construit le record à écrire :
    │   - Champs de base (type, dates, n°, etc.)
    │   - Trimestre calculé depuis la date visa mairie
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
| `debounce(fn, delay)` | Debounce une fonction (utilisé pour l'autocomplete commune) |
| `enjeuColForItem(item)` | Retourne le nom de colonne Grist pour un motif/objet (ex: `Enjeu_ERP123`) |
