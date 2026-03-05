// src/lib/grist/hooks.ts
//
// Hook React principal pour tous les widgets DDT31.
// Encapsule l'initialisation Grist, le chargement du plugin API et
// la récupération de l'utilisateur courant.
"use client";

import { useEffect, useState } from "react";
import { initGristOrMock } from "./init";
import type { GristDocAPI } from "./meta";

/**
 * Profil de l'utilisateur Grist connecté.
 * Affiché dans la top bar de chaque widget.
 */
export type GristUser = { name: string; email: string };

/* ─────────────────────────────────────────────────────────────────
   fetchGristUser
   Tente de récupérer l'identité de l'utilisateur connecté.

   Deux méthodes sont essayées dans l'ordre :

   1. grist.getUserProfile()   — appel postMessage vers le parent Grist,
      disponible sur les versions récentes (≥ ~1.1.5). Aucun HTTP,
      aucun problème CORS.

   2. Proxy n8n                — si NEXT_PUBLIC_GRIST_PROFILE_PROXY_URL
      est défini au build, on récupère un token via getAccessToken()
      et on l'envoie à un webhook n8n qui appelle /api/profile côté
      serveur (contourne le CORS de l'instance self-hosted).

   Si les deux méthodes échouent silencieusement, gristUser reste null
   et le nom n'est pas affiché dans la top bar.
───────────────────────────────────────────────────────────────── */
async function fetchGristUser(setGristUser: (u: GristUser) => void) {
  const gristRaw = (window as any).grist;

  // ── Méthode 1 : getUserProfile() via postMessage ──────────────────
  if (typeof gristRaw?.getUserProfile === "function") {
    try {
      const p = await gristRaw.getUserProfile();
      if (p?.name || p?.email) {
        setGristUser({ name: p.name || p.email, email: p.email || "" });
        return;
      }
    } catch { /* non disponible sur cette version */ }
  }

  // ── Méthode 2 : proxy n8n ────────────────────────────────────────
  // Variable d'environnement injectée au build (voir deploy.yml + secret GitHub).
  // Le webhook n8n reçoit le token Grist et appelle /api/profile côté serveur.
  const profileProxyUrl = process.env.NEXT_PUBLIC_GRIST_PROFILE_PROXY_URL;
  const rawDocApi = gristRaw?.docApi;
  if (profileProxyUrl && typeof rawDocApi?.getAccessToken === "function") {
    try {
      const tokenResult = await rawDocApi.getAccessToken({ readOnly: true });
      const token: string | undefined = tokenResult?.token;
      if (token) {
        // GET simple sans header custom → pas de preflight CORS.
        // n8n doit répondre avec Access-Control-Allow-Origin: *.
        const resp = await fetch(
          `${profileProxyUrl}?token=${encodeURIComponent(token)}`,
        );
        if (resp.ok) {
          const p = await resp.json();
          const name  = p?.name  || p?.email || "";
          const email = p?.email || "";
          if (name) { setGristUser({ name, email }); return; }
        }
      }
    } catch { /* proxy indisponible */ }
  }
}

/* ─────────────────────────────────────────────────────────────────
   useGristInit
   Hook principal à appeler une fois par widget.

   Séquence d'initialisation :
   1. Si on est dans une iframe et que window.grist n'existe pas encore,
      charge grist-plugin-api.js depuis docs.getgrist.com.
   2. Appelle initGristOrMock() pour détecter le mode (grist/mock/rest/none).
   3. En mode grist, tente de récupérer l'utilisateur connecté.

   @param opts.requiredAccess  Niveau d'accès demandé : "read table" (lecture)
                               ou "full" (lecture + écriture). Défaut : "full".

   @returns
     - mode      : contexte d'exécution détecté
     - docApi    : API document Grist (fetchTable, applyUserActions…)
     - gristUser : utilisateur connecté, ou null si non disponible
───────────────────────────────────────────────────────────────── */
export function useGristInit(opts?: { requiredAccess?: "read table" | "full" }) {
  const [mode, setMode]           = useState<"boot" | "grist" | "mock" | "rest" | "none">("boot");
  const [docApi, setDocApi]       = useState<GristDocAPI | null>(null);
  const [gristUser, setGristUser] = useState<GristUser | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const isInFrame = typeof window !== "undefined" && window.self !== window.top;

        // Charge le plugin API Grist si nécessaire (uniquement en iframe)
        if (isInFrame && !(window as any).grist) {
          await new Promise<void>((resolve, reject) => {
            const existing = document.querySelector('script[data-grist-plugin-api="1"]');
            if (existing) return resolve();
            const s = document.createElement("script");
            s.src = "https://docs.getgrist.com/grist-plugin-api.js";
            s.async = true;
            s.setAttribute("data-grist-plugin-api", "1");
            s.onload  = () => resolve();
            s.onerror = () => reject(new Error("Impossible de charger grist-plugin-api.js"));
            document.head.appendChild(s);
          });
        }

        const result = await initGristOrMock({
          requiredAccess: opts?.requiredAccess ?? "full",
        });
        setMode(result.mode);
        setDocApi(result.docApi);

        if (result.mode === "grist") {
          fetchGristUser(setGristUser);
        }
      } catch {
        setMode("none");
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { mode, docApi, gristUser };
}
