// src/lib/grist/init.ts
//
// Point d'entrée unique pour initialiser la connexion Grist.
// Détecte automatiquement le contexte d'exécution et choisit
// le mode approprié : iframe Grist, mock de développement, proxy REST n8n
// ou absence totale de contexte Grist.

/**
 * Résultat de l'initialisation Grist.
 *
 * @property mode     - Contexte détecté :
 *   - `"grist"` : widget embarqué dans une iframe Grist (production normale)
 *   - `"mock"`  : `window.__GRIST_MOCK__` présent (tests / dev offline)
 *   - `"rest"`  : NEXT_PUBLIC_GRIST_PROXY_URL défini (page standalone via n8n)
 *   - `"none"`  : aucun contexte Grist disponible
 * @property grist    - Objet `window.grist` (plugin API) ou mock ; `null` en mode REST/none
 * @property docApi   - API document Grist : fetchTable, applyUserActions…
 */
export type InitResult = {
  mode: "grist" | "mock" | "rest" | "none";
  grist: any | null;
  docApi: any | null;
};

/**
 * Initialise la connexion Grist selon le contexte d'exécution.
 *
 * Ordre de priorité :
 * 1. **Mode Grist (iframe)** — `window.grist` présent ET page dans une iframe
 * 2. **Mode Mock**           — `window.__GRIST_MOCK__` présent (utile pour les tests)
 * 3. **Mode REST**           — `NEXT_PUBLIC_GRIST_PROXY_URL` défini au build (pages standalone)
 * 4. **Mode None**           — aucun contexte disponible
 *
 * @param opts.requiredAccess      - Niveau d'accès demandé à Grist : `"read table"` ou `"full"`
 * @param opts.onRecord            - Callback appelé par Grist quand la ligne sélectionnée change
 * @param opts.onApplyUserActions  - Callback appelé après chaque écriture dans Grist
 */
export async function initGristOrMock(
  opts: {
    requiredAccess?: "read table" | "full";
    onRecord?: (rec: any, mapping?: any) => void;
    onApplyUserActions?: (actions: any[]) => void;
  } = {}
): Promise<InitResult> {
  const requiredAccess = opts.requiredAccess ?? "full";

  // ──────────────────────────────────────────────────────────
  // 1. Mode GRIST (iframe)
  // ──────────────────────────────────────────────────────────
  // Grist embarque les widgets dans des iframes. On détecte ce contexte
  // en vérifiant à la fois la présence de window.grist ET le fait que
  // la page est bien dans une iframe (window.self !== window.top).
  const grist =
    typeof window !== "undefined" ? (window as any).grist ?? null : null;
  const isInFrame = typeof window !== "undefined" && window.self !== window.top;

  if (grist?.ready && isInFrame) {
    try {
      // Déclare le widget à Grist avec le niveau d'accès requis.
      // Grist affiche un bandeau de permission si l'accès n'est pas encore accordé.
      grist.ready({ requiredAccess });
    } catch {
      // Certaines versions Grist peuvent échouer ici — on ignore silencieusement.
    }

    // Abonnement à la sélection de ligne (facultatif, utilisé dans l'enregistrement)
    if (typeof opts.onRecord === "function") {
      try {
        grist.onRecord((rec: any, mapping: any) => {
          opts.onRecord?.(rec, mapping);
        });
      } catch { /* ignore */ }
    }

    // Abonnement aux actions utilisateur (écriture) — facultatif
    if (typeof opts.onApplyUserActions === "function") {
      try {
        if (typeof grist.onApplyUserActions === "function") {
          grist.onApplyUserActions((actions: any[]) => {
            opts.onApplyUserActions?.(actions);
          });
        }
      } catch { /* ignore */ }
    }

    return {
      mode: "grist",
      grist,
      docApi: grist.docApi ?? null,
    };
  }

  // ──────────────────────────────────────────────────────────
  // 2. Mode MOCK
  // ──────────────────────────────────────────────────────────
  // Permet de tester les widgets hors Grist en injectant
  // `window.__GRIST_MOCK__ = { docApi: { fetchTable, applyUserActions } }`.
  const mock =
    typeof window !== "undefined"
      ? (window as any).__GRIST_MOCK__ ?? null
      : null;

  if (mock?.docApi) {
    if (typeof opts.onRecord === "function") {
      try { mock.onRecord?.((rec: any, mapping: any) => { opts.onRecord?.(rec, mapping); }); }
      catch { /* ignore */ }
    }
    if (typeof opts.onApplyUserActions === "function") {
      try { mock.onApplyUserActions?.((actions: any[]) => { opts.onApplyUserActions?.(actions); }); }
      catch { /* ignore */ }
    }
    return { mode: "mock", grist: mock, docApi: mock.docApi };
  }

  // ──────────────────────────────────────────────────────────
  // 3. Mode REST (proxy n8n)
  // ──────────────────────────────────────────────────────────
  // Utilisé pour les pages standalone (magic links, formulaires publics)
  // qui doivent lire/écrire dans Grist sans être dans une iframe.
  // Le proxy n8n (NEXT_PUBLIC_GRIST_PROXY_URL) gère l'authentification
  // et évite les problèmes CORS.
  if (process.env.NEXT_PUBLIC_GRIST_PROXY_URL) {
    const { createRestDocApi } = await import("./rest");
    return { mode: "rest", grist: null, docApi: createRestDocApi() };
  }

  // ──────────────────────────────────────────────────────────
  // 4. Aucun contexte Grist
  // ──────────────────────────────────────────────────────────
  return { mode: "none", grist: null, docApi: null };
}
