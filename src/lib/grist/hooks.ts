// src/lib/grist/hooks.ts
"use client";

import { useEffect, useState } from "react";
import { initGristOrMock } from "./init";
import type { GristDocAPI } from "./meta";

export type GristUser = { name: string; email: string };

/* ─────────────────────────────────────────────────────────────────
   tryDecodeJwt
   Si le token Grist est un JWT, on peut décoder le payload (base64url)
   sans aucun appel réseau ni CORS.
───────────────────────────────────────────────────────────────── */
function tryDecodeJwt(token: string): GristUser | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    // base64url → base64 standard
    const b64  = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(b64);
    const payload = JSON.parse(json);
    const name  = payload.name  || payload.email || payload.sub || "";
    const email = payload.email || "";
    if (name) return { name, email };
  } catch {
    // pas un JWT valide
  }
  return null;
}

/* ─────────────────────────────────────────────────────────────────
   fetchGristUser
   Tente plusieurs méthodes pour récupérer l'utilisateur courant.
   Tout est client-side (postMessage ou décodage JWT) — pas de fetch
   cross-origin. L'app est un export statique GitHub Pages : les
   routes API Next.js ne sont pas disponibles.
───────────────────────────────────────────────────────────────── */
async function fetchGristUser(setGristUser: (u: GristUser) => void) {
  const gristRaw = (window as any).grist;
  const rawDocApi = gristRaw?.docApi;

  // ── Méthode 1 : grist.getUserProfile() — postMessage vers Grist ──
  // Disponible dans les versions récentes du plugin API Grist.
  if (typeof gristRaw?.getUserProfile === "function") {
    try {
      const profile = await gristRaw.getUserProfile();
      const name  = profile?.name  || profile?.email || "";
      const email = profile?.email || "";
      if (name) {
        setGristUser({ name, email });
        return;
      }
      console.warn("[DDT31] getUserProfile() vide :", profile);
    } catch (e) {
      console.warn("[DDT31] Méthode 1 (getUserProfile) échouée :", e);
    }
  } else {
    console.warn("[DDT31] grist.getUserProfile n'est pas disponible");
  }

  // ── Méthode 2 : getAccessToken → décodage JWT (zéro réseau) ──────
  // Le token retourné est souvent un JWT signé dont le payload contient
  // name / email sans qu'on ait besoin d'appeler l'API REST.
  if (typeof rawDocApi?.getAccessToken === "function") {
    try {
      const tokenResult = await rawDocApi.getAccessToken({ readOnly: true });
      const { token } = tokenResult ?? {};
      if (token) {
        const user = tryDecodeJwt(token);
        if (user) {
          setGristUser(user);
          return;
        }
        console.warn("[DDT31] JWT décodé mais sans name/email :", token.slice(0, 40) + "...");
      } else {
        console.warn("[DDT31] getAccessToken a retourné :", tokenResult);
      }
    } catch (e) {
      console.warn("[DDT31] Méthode 2 (JWT decode) échouée :", e);
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
          fetchGristUser(setGristUser);
        }
      } catch {
        setMode("none");
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { mode, docApi, gristUser };
}
