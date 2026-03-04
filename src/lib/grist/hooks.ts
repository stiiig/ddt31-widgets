// src/lib/grist/hooks.ts
"use client";

import { useEffect, useState } from "react";
import { initGristOrMock } from "./init";
import type { GristDocAPI } from "./meta";

export type GristUser = { name: string; email: string };

/* ─────────────────────────────────────────────────────────────────
   tryDecodeJwtPayload
   Décode le payload d'un JWT (base64url) sans vérification de sig.
───────────────────────────────────────────────────────────────── */
function tryDecodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const b64  = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64));
  } catch {
    return null;
  }
}

/* ─────────────────────────────────────────────────────────────────
   fetchGristUser
   Tente plusieurs méthodes pour récupérer l'utilisateur courant.
   Tout est client-side (postMessage / fetchTable) — pas de fetch
   cross-origin. L'app est un export statique GitHub Pages.
───────────────────────────────────────────────────────────────── */
async function fetchGristUser(
  setGristUser: (u: GristUser) => void,
  docApi: GristDocAPI | null,
) {
  const gristRaw = (window as any).grist;
  const rawDocApi = gristRaw?.docApi ?? docApi;

  // ── Méthode 1 : grist.getUserProfile() — postMessage vers Grist ──
  if (typeof gristRaw?.getUserProfile === "function") {
    try {
      const profile = await gristRaw.getUserProfile();
      const name  = profile?.name  || profile?.email || "";
      const email = profile?.email || "";
      if (name) { setGristUser({ name, email }); return; }
      console.warn("[DDT31] getUserProfile() vide :", profile);
    } catch (e) {
      console.warn("[DDT31] Méthode 1 (getUserProfile) échouée :", e);
    }
  } else {
    console.warn("[DDT31] grist.getUserProfile n'est pas disponible");
  }

  // ── Méthode 2 : JWT userId → lookup _grist_Principals ────────────
  // getAccessToken() retourne un JWT HS256 dont le payload contient
  // un userId. On croise avec la table système _grist_Principals pour
  // récupérer name + email. Tout passe par postMessage (fetchTable).
  if (typeof rawDocApi?.getAccessToken === "function") {
    try {
      const tokenResult = await rawDocApi.getAccessToken({ readOnly: true });
      const { token } = tokenResult ?? {};

      if (token) {
        const payload = tryDecodeJwtPayload(token);
        console.info("[DDT31] JWT payload :", payload);

        // Cas simple : name/email directement dans le payload
        const directName  = payload?.name  || payload?.email || payload?.sub || "";
        const directEmail = payload?.email || "";
        if (directName) {
          setGristUser({ name: directName, email: directEmail });
          return;
        }

        // Cas Grist self-hosted : seul userId est présent
        const userId: number | undefined =
          payload?.userId ?? payload?.uid ?? payload?.id;

        if (userId != null && typeof rawDocApi?.fetchTable === "function") {
          try {
            const principals = await rawDocApi.fetchTable("_grist_Principals");
            console.info("[DDT31] _grist_Principals colonnes :", Object.keys(principals));
            const ids = principals.userId as number[] | undefined;
            if (ids) {
              const idx = ids.findIndex((id: number) => id === userId);
              if (idx >= 0) {
                const name  = principals.name?.[idx]  || principals.email?.[idx] || "";
                const email = principals.email?.[idx] || "";
                if (name) { setGristUser({ name, email }); return; }
                console.warn("[DDT31] _grist_Principals row trouvée mais name/email vides, idx=", idx, principals);
              } else {
                console.warn("[DDT31] userId", userId, "introuvable dans _grist_Principals ids :", ids);
              }
            } else {
              console.warn("[DDT31] _grist_Principals pas de colonne userId :", Object.keys(principals));
            }
          } catch (e) {
            console.warn("[DDT31] fetchTable _grist_Principals échouée :", e);
          }
        } else {
          console.warn("[DDT31] JWT payload sans userId reconnu :", payload);
        }
      } else {
        console.warn("[DDT31] getAccessToken a retourné :", tokenResult);
      }
    } catch (e) {
      console.warn("[DDT31] Méthode 2 (JWT + Principals) échouée :", e);
    }
  } else {
    console.warn("[DDT31] grist.docApi.getAccessToken n'est pas disponible");
  }

  // ── Méthode 3 : getUserTeams → owner de l'org personnelle ────────
  if (typeof gristRaw?.getUserTeams === "function") {
    try {
      const teams = await gristRaw.getUserTeams();
      const orgs: any[] = Array.isArray(teams) ? teams : (teams?.orgs ?? []);
      for (const org of orgs) {
        if (org?.owner?.name) {
          setGristUser({ name: org.owner.name, email: org.owner.email || "" });
          return;
        }
      }
      console.warn("[DDT31] getUserTeams : aucun owner.name trouvé :", orgs);
    } catch (e) {
      console.warn("[DDT31] Méthode 3 (getUserTeams) échouée :", e);
    }
  } else {
    console.warn("[DDT31] grist.getUserTeams n'est pas disponible");
  }

  console.warn("[DDT31] Impossible de récupérer l'utilisateur Grist (toutes méthodes échouées)");
}

/* ─────────────────────────────────────────────────────────────────
   useGristInit
   Charge grist-plugin-api.js et initialise la connexion Grist.
───────────────────────────────────────────────────────────────── */
export function useGristInit(opts?: { requiredAccess?: "read table" | "full" }) {
  const [mode, setMode]           = useState<"boot" | "grist" | "mock" | "rest" | "none">("boot");
  const [docApi, setDocApi]       = useState<GristDocAPI | null>(null);
  const [gristUser, setGristUser] = useState<GristUser | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const isInFrame = typeof window !== "undefined" && window.self !== window.top;
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

        // Récupération utilisateur (mode iframe uniquement)
        if (result.mode === "grist") {
          fetchGristUser(setGristUser, result.docApi);
        }
      } catch {
        setMode("none");
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { mode, docApi, gristUser };
}
