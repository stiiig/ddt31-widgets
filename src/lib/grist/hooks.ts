// src/lib/grist/hooks.ts
"use client";

import { useEffect, useState } from "react";
import { initGristOrMock } from "./init";
import type { GristDocAPI } from "./meta";

export type GristUser = { name: string; email: string };

/* ─────────────────────────────────────────────────────────────────
   fetchGristUser
   Tente plusieurs méthodes pour récupérer l'utilisateur courant.
   Les console.warn permettent de diagnostiquer en cas d'échec.
───────────────────────────────────────────────────────────────── */
async function fetchGristUser(setGristUser: (u: GristUser) => void) {
  const gristRaw = (window as any).grist;
  const rawDocApi = gristRaw?.docApi;

  // ── Méthode 1 : getAccessToken → proxy Next.js → REST /api/profile ──
  // On passe par /api/grist-profile (même domaine) pour éviter le CORS.
  if (typeof rawDocApi?.getAccessToken === "function") {
    try {
      const tokenResult = await rawDocApi.getAccessToken({ readOnly: true });
      const { token, baseUrl } = tokenResult ?? {};

      if (token && baseUrl) {
        const resp = await fetch("/api/grist-profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, baseUrl }),
        });
        if (resp.ok) {
          const p = await resp.json();
          const name = p.name || p.email || "";
          if (name) {
            setGristUser({ name, email: p.email || "" });
            return;
          }
          console.warn("[DDT31] /api/grist-profile OK mais name/email vides :", p);
        } else {
          console.warn("[DDT31] /api/grist-profile status :", resp.status);
        }
      } else {
        console.warn("[DDT31] getAccessToken a retourné :", tokenResult);
      }
    } catch (e) {
      console.warn("[DDT31] Méthode 1 (proxy grist-profile) échouée :", e);
    }
  } else {
    console.warn("[DDT31] grist.docApi.getAccessToken n'est pas disponible");
  }

  // ── Méthode 2 : getUserTeams → owner de l'org personnelle ───────
  if (typeof gristRaw?.getUserTeams === "function") {
    try {
      const teams = await gristRaw.getUserTeams();
      // getUserTeams retourne un tableau d'orgs ; l'org personnelle est
      // celle dont l'utilisateur courant est propriétaire.
      const orgs: any[] = Array.isArray(teams) ? teams : (teams?.orgs ?? []);
      for (const org of orgs) {
        if (org?.owner?.name) {
          setGristUser({
            name:  org.owner.name,
            email: org.owner.email || "",
          });
          return;
        }
      }
      console.warn("[DDT31] getUserTeams : aucun owner.name trouvé :", orgs);
    } catch (e) {
      console.warn("[DDT31] Méthode 2 (getUserTeams) échouée :", e);
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
