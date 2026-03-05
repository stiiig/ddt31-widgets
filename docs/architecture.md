# Architecture technique

## Stack

| Technologie | Version | Rôle |
|-------------|---------|------|
| Next.js | 14 | Framework React, export statique (`output: "export"`) |
| TypeScript | 5 | Typage strict sur tout le projet |
| Font Awesome | 6 (CDN) | Icônes |
| GitHub Pages | — | Hébergement statique |
| GitHub Actions | — | CI/CD automatique |
| Grist Plugin API | latest | Communication avec l'instance Grist |

---

## Lib Grist (`src/lib/grist/`)

### `init.ts` — Détection du contexte

```
initGristOrMock()
│
├─ window.grist && isInFrame  →  mode "grist"   (production iframe)
├─ window.__GRIST_MOCK__      →  mode "mock"    (dev / tests)
├─ NEXT_PUBLIC_GRIST_PROXY_URL →  mode "rest"  (pages standalone)
└─ sinon                      →  mode "none"
```

### `hooks.ts` — Hook principal

`useGristInit(opts)` est appelé une fois au montage de chaque widget. Il :
1. Charge `grist-plugin-api.js` si nécessaire (depuis `docs.getgrist.com`)
2. Appelle `initGristOrMock()` pour détecter le mode
3. En mode `grist`, tente de récupérer l'utilisateur via :
   - `grist.getUserProfile()` (postMessage, Grist ≥ 1.1.5)
   - Webhook n8n `grist-user-profile` (fallback CORS proxy)

Retourne : `{ mode, docApi, gristUser }`

### `meta.ts` — Types et utilitaires

- **Types** : `GristDocAPI`, `ColMeta`, `RefType`, `RefItem`, `RefCache`
- **`pickCol`-like** : résolution des noms de colonnes avec fallback normalisé
- **`loadColumnsMetaFor`** : charge les métadonnées d'une table via `_grist_Tables_column`
- **`ensureRefCache`** : cache des colonnes `Ref:*` pour les listes de référence
- **Dates** : `unixSecondsToISODate`, `isoDateToUnixSeconds` (Grist stocke en Unix secondes)
- **Listes Grist** : `encodeListCell / decodeListCell` (`["L", ...]`)

### `rest.ts` — Client REST via n8n

Implémente la même interface que `grist.docApi` mais via des appels HTTP
au proxy n8n (`NEXT_PUBLIC_GRIST_PROXY_URL`). Utilisé pour les pages
standalone (magic links) qui ne sont pas dans une iframe Grist.

Trick CORS : les requêtes POST utilisent `Content-Type: text/plain` au lieu
de `application/json` — une "simple CORS request" qui ne déclenche pas de
preflight OPTIONS.

---

## Communication avec Grist

### Mode iframe (production)

```
Widget (iframe)                    Grist (parent window)
      │                                      │
      │  postMessage: grist.ready()          │
      │ ─────────────────────────────────>   │
      │                                      │
      │  postMessage: configure + access     │
      │ <─────────────────────────────────   │
      │                                      │
      │  docApi.fetchTable("MaTable")        │
      │ ─────────────────────────────────>   │
      │                                      │
      │  { id:[], col1:[], col2:[] }         │  ← format "columnar"
      │ <─────────────────────────────────   │
      │                                      │
      │  docApi.applyUserActions([...])      │
      │ ─────────────────────────────────>   │
```

Tout passe par `postMessage` — aucun appel HTTP, aucun problème CORS.

### Mode REST (pages standalone)

```
Widget (browser)          n8n Proxy                  Grist REST API
      │                       │                             │
      │  GET ?table=TABLE      │                             │
      │ ─────────────────>    │                             │
      │                       │  GET /api/docs/{id}/tables  │
      │                       │ ──────────────────────────> │
      │                       │  { records: [...] }         │
      │                       │ <────────────────────────── │
      │  { records: [...] }   │                             │
      │ <─────────────────    │                             │
```

---

## Format des données Grist

Grist retourne les tables au format **columnar** (par colonne, pas par ligne) :

```ts
// Exemple pour une table avec 3 lignes :
{
  id:  [1, 2, 3],
  Nom: ["Paris", "Lyon", "Marseille"],
  Pop: [2161000, 513000, 861000],
}
```

Les listes (ChoiceList) sont encodées `["L", "val1", "val2"]`.

Les références (`Ref:*`) sont des entiers (row ID de la table cible).

Les dates sont des timestamps Unix en secondes (pas en millisecondes).

---

## Déploiement

### GitHub Actions (`.github/workflows/deploy.yml`)

```
push master
    │
    ├─ npm ci
    ├─ npm run build  (next build → export statique dans /out)
    │   └─ Variables injectées : NEXT_PUBLIC_GRIST_PROFILE_PROXY_URL
    └─ Deploy to GitHub Pages
```

### Variables d'environnement au build

Les variables `NEXT_PUBLIC_*` sont "baked" dans le bundle JS à la compilation.
Elles sont accessibles via `process.env.NEXT_PUBLIC_XXX` dans le code React
mais **visibles dans le bundle final** — ne jamais y mettre de secrets.

| Variable | Source | Usage |
|----------|--------|-------|
| `NEXT_PUBLIC_GRIST_PROFILE_PROXY_URL` | GitHub Secret `GRIST_PROFILE_PROXY_URL` | Webhook n8n pour récupérer le profil utilisateur Grist |
| `NEXT_PUBLIC_GRIST_PROXY_URL` | *(non défini en prod)* | Proxy n8n tables — mode REST standalone uniquement |

---

## Identité utilisateur

L'affichage du nom de l'utilisateur connecté dans la top bar suit cette cascade :

```
1. grist.getUserProfile()          → postMessage, Grist ≥ 1.1.5
        ↓ (échec)
2. getAccessToken() + GET n8n proxy → serveur n8n appelle /api/profile
        ↓ (échec ou proxy non configuré)
3. gristUser = null                → rien affiché
```

Pour configurer le proxy n8n, voir [README](../README.md#variables-denvironnement-github-secrets).
