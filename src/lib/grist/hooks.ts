// src/lib/grist/hooks.ts
"use client";

import { useEffect, useState } from "react";
import { initGristOrMock } from "./init";
import type { GristDocAPI } from "./meta";

export type GristUser = { name: string; email: string };

/* ─────────────────────────────────────────────────────────────────
   fetchGristUser
   1. getUserProfile()  — postMessage, dispo sur Grist récent
   2. proxy n8n         — NEXT_PUBLIC_GRIST_PROFILE_PROXY_URL?token=
      n8n appelle /api/profile côté serveur → pas de CORS
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
  const profileProxyUrl = process.env.NEXT_PUBLIC_GRIST_PROFILE_PROXY_URL;
  const rawDocApi = gristRaw?.docApi;
  if (profileProxyUrl && typeof rawDocApi?.getAccessToken === "function") {
    try {
      const tokenResult = await rawDocApi.getAccessToken({ readOnly: true });
      const token: string | undefined = tokenResult?.token;
      if (token) {
        // GET simple (pas de preflight CORS) — n8n répond avec ACAO: *
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
