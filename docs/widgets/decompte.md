# Widget Décompte

Saisie et suivi des **décomptes mensuels d'actes d'urbanisme** par commune.
Il combine un formulaire de saisie, un journal des modifications et un tableau de bord analytique.

---

## Fonctionnalités

### Onglet Saisie
- Recherche d'une commune par nom ou code INSEE
- Sélection du mois/année avec navigation ← →
- Saisie des compteurs pour chaque type d'acte (PD, PC, PCM, PA, PAM, ZA, DP, DP Div., Trans/Proro, Ret./Rej., Ref./Sursis, CU)
- Mode **Papier** : bascule entre actes @CTES et actes sur papier — affiche une bannière orange distincte
- Sauvegarde via `applyUserActions` → crée ou met à jour la ligne `DECOMPTE` correspondante
- **Journal** latéral (sidebar) : historique des `DECOMPTE_LOGS` pour la commune et le mois sélectionnés, avec bouton Annuler

### Onglet Tableau de bord
- Vue **Tableau** (tableau croisé) : communes en lignes × types d'actes en colonnes
  - Colonnes vides (tous les totaux à 0 sur la période) masquées automatiquement
  - Filtres par arrondissement (onglets : Tous / Toulouse / Muret / Saint-Gaudens)
  - Ligne de totaux par type d'acte
  - Lignes de synthèse : Total, Total Fixe, Total Fixe+Rotation+Ciblée, Total sans Fixe+Rotation+Ciblée
- Vue **Graphique** : représentation visuelle des volumes par type d'acte

---

## Tables Grist

| Table | Accès | Colonnes clés |
|-------|-------|---------------|
| `Communes` | Lecture | `Nom commune`, `Code INSEE`, `Arrondissement`, `Papier` |
| `Communes_Statut` | Lecture | `Commune` (Ref), `Selection` (ChoiceList), `Debut`, `Fin` |
| `DECOMPTE` | Lecture + Écriture | `Commune` (Ref), `Annee`, `Mois`, `Trimestre`, + 1 col par type d'acte, `Papier` |
| `DECOMPTE_LOGS` | Lecture + Écriture | `Commune` (Ref), `DecompteId` (Ref), `Type`, `Delta`, `Timestamp`, `CommuneNom`, `Annee`, `Mois` |

---

## Types d'actes (`DOC_TYPES`)

| Clé | Code affiché | Label complet |
|-----|-------------|---------------|
| `PD` | PD | Permis de Démolir |
| `PC` | PC | Permis de Construire |
| `Pcm` | PCM | Permis de Construire modificatif |
| `PA` | PA | Permis d'Aménager |
| `Pam` | PAM | Permis d'Aménager modificatif |
| `Permis_ZA` | ZA | Permis Zone Agricole |
| `DP` | DP | Déclaration Préalable *(héros — grande taille)* |
| `DP_Division` | DP Div. | DP Division |
| `Trans_Proro` | Trans/Proro | Transmissions & Prorogations |
| `Retraits_Rejets` | Ret./Rej. | Retraits & Rejets |
| `Refus_Sursis` | Ref./Sursis | Refus & Sursis |
| `CU` | CU | Certificat d'Urbanisme |

---

## État React principal

| State | Type | Description |
|-------|------|-------------|
| `communeList` | `Commune[]` | Liste complète des communes chargées |
| `selectedCommune` | `Commune \| null` | Commune active dans le formulaire |
| `selectedYear` / `selectedMonth` | `number` | Période courante |
| `counts` | `Record<string, number>` | Valeurs du formulaire (1 entrée par DocType) |
| `savedCounts` | `Record<string, number>` | Valeurs sauvegardées (pour détecter les changements) |
| `decompteId` | `number \| null` | Row ID Grist de la ligne DECOMPTE courante |
| `isPapier` | `boolean` | True si les actes de ce mois sont en mode papier |
| `dashArr` | `Set<string>` | Arrondissements actifs dans le dashboard |
| `dashSubTab` | `"croise" \| "chart"` | Vue active dans le tableau de bord |
| `tab` | `"saisie" \| "dashboard"` | Onglet actif |
| `sidebarOpen` | `boolean` | Sidebar journal ouverte ou non |
| `logs` | `LogEntry[]` | Entrées du journal chargées |

---

## Flux de saisie

```
Sélection commune
    │
    ▼
loadDecompteForCommune()
    │ fetchTable("DECOMPTE") filtré sur communeId + mois + année
    │ → peuple counts + savedCounts + decompteId
    ▼
Utilisateur modifie les compteurs
    │
    ▼
handleSave()
    │
    ├─ decompteId existe ?
    │   ├─ OUI → UpdateRecord DECOMPTE [decompteId]
    │   └─ NON → AddRecord DECOMPTE (crée la ligne)
    │
    └─ AddRecord DECOMPTE_LOGS (trace le delta pour chaque type modifié)
```

---

## Tableau de bord — Logique filtrage

```
communeList (toutes communes)
    │
    ├─ filtre dashArr (arrondissements sélectionnés)
    │
    └─ communeList filtrée
            │
            ├─ visibleTypes = DOC_TYPES où ∃ commune avec compteur > 0
            │   (colonnes vides masquées automatiquement)
            │
            └─ Tableau croisé commune × visibleTypes
```

### Lignes spéciales

| Ligne | Calcul |
|-------|--------|
| **Total** | Somme de toutes les communes visibles |
| **Total Fixe** | Communes ayant la sélection "Fixe" ce trimestre |
| **Total Fixe+Rotation+Ciblée** | Communes avec une sélection active (Fixe, Rotation ou Ciblée) |
| **Total sans Fixe+Rotation+Ciblée** | Total − communes ayant une sélection active |

---

## Mode Papier

La colonne `Papier` dans la table `DECOMPTE` indique si les données du mois ont été saisies
à partir de bulletins papier plutôt que d'@CTES. Quand `isPapier === true` :
- Le bouton "Papier" dans la barre de période s'affiche en orange (`Papier ON`)
- Une bannière orange "Mode Papier activé — chaque acte ajouté sera comptabilisé en Papier"
  s'affiche sous la barre de période

---

## Journal (`DECOMPTE_LOGS`)

À chaque sauvegarde, autant de logs sont créés que de types d'actes modifiés.
Chaque log enregistre :
- `Delta` : différence (positif = hausse, négatif = baisse)
- `Type` : code de l'acte (ex: "PC", "DP")
- `Timestamp` : ISO 8601
- `CommuneNom` : dénormalisé pour la lisibilité

La sidebar affiche les logs du mois courant pour la commune sélectionnée,
du plus récent au plus ancien. Chaque entrée dispose d'un bouton **Annuler**
qui applique le delta inverse.
