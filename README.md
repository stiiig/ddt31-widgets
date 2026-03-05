# DDT31 — Widgets Grist

Widgets personnalisés pour la **Direction Départementale des Territoires de la Haute-Garonne (DDT31)**, embarqués dans [Grist](https://www.getgrist.com/) via le système de Custom Widgets.

Construit avec **Next.js 14** (export statique), déployé sur **GitHub Pages**.

---

## Widgets disponibles

| Widget | Chemin | Description |
|--------|--------|-------------|
| [Décompte](docs/widgets/decompte.md) | `/widgets/decompte` | Saisie mensuelle des actes d'urbanisme par commune, tableau de bord multi-vues |
| [Stratégie](docs/widgets/strategie.md) | `/widgets/strategie` | Visualisation des statuts de contrôle des communes (Fixe / Rotation / Ciblée) |
| [Enregistrement](docs/widgets/enregistrement.md) | `/widgets/enregistrement` | Formulaire de saisie des actes AN_PC avec dashboard d'analyse |

---

## Architecture

```
src/
├── lib/grist/
│   ├── init.ts      # Détection du contexte (iframe / mock / REST / none)
│   ├── hooks.ts     # Hook React useGristInit + récupération utilisateur
│   ├── meta.ts      # Types, helpers colonnes, cache Ref, dates
│   └── rest.ts      # Client REST Grist via proxy n8n (mode standalone)
│
└── app/widgets/
    ├── decompte/
    │   ├── page.tsx     # Widget décompte
    │   └── styles.css
    ├── strategie/
    │   ├── page.tsx     # Widget stratégie
    │   └── styles.css
    └── enregistrement/
        ├── page.tsx     # Widget enregistrement
        └── styles.css
```

### Modes d'exécution

Les widgets détectent automatiquement leur contexte via `initGristOrMock()` :

| Mode | Condition | Usage |
|------|-----------|-------|
| `grist` | Embarqué dans une iframe Grist | Production normale |
| `mock` | `window.__GRIST_MOCK__` présent | Tests locaux sans Grist |
| `rest` | `NEXT_PUBLIC_GRIST_PROXY_URL` défini | Pages standalone (magic links) |
| `none` | Aucun contexte | Rendu statique, affiche un état vide |

---

## Tables Grist utilisées

| Table Grist | Widgets | Rôle |
|-------------|---------|------|
| `Communes` | Tous | Référentiel communes (nom, INSEE, arrondissement…) |
| `Communes_Statut` | Décompte, Stratégie | Périodes de sélection (Fixe / Rotation / Ciblée) |
| `DECOMPTE` | Décompte | Compteurs mensuels par commune et type d'acte |
| `DECOMPTE_LOGS` | Décompte | Journal des modifications (delta, horodatage) |
| `AN_PC` | Enregistrement | Actes d'urbanisme individuels (PC, PA, PD, DP) |

---

## Déploiement

Le déploiement est entièrement automatisé via GitHub Actions sur push `master`.

```
git push origin master  →  GitHub Actions build  →  GitHub Pages
```

### Variables d'environnement (GitHub Secrets)

| Secret | Description |
|--------|-------------|
| `GRIST_PROFILE_PROXY_URL` | URL du webhook n8n `grist-user-profile` pour récupérer le nom de l'utilisateur connecté |

> Les variables `NEXT_PUBLIC_*` sont injectées **au moment du build** (export statique)
> et se retrouvent dans le bundle JS. Ne jamais y mettre de secrets sensibles.

---

## Développement local

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # export statique dans /out
```

Pour tester un widget sans Grist, injecter un mock dans la console :

```js
window.__GRIST_MOCK__ = {
  docApi: {
    fetchTable: async (tableId) => ({ /* données de test */ }),
    applyUserActions: async (actions) => ({ tableId: tableId, rowIds: [1] }),
  }
};
```

---

## Documentation détaillée

- [Widget Décompte](docs/widgets/decompte.md)
- [Widget Stratégie](docs/widgets/strategie.md)
- [Widget Enregistrement](docs/widgets/enregistrement.md)
- [Architecture technique](docs/architecture.md)
