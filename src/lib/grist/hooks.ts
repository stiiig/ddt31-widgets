// src/lib/grist/hooks.ts
"use client";

import { useEffect, useState, useCallback } from "react";
import { initGristOrMock } from "./init";
import type { GristDocAPI } from "./meta";

export type GristUser = { name: string; email: string };

const LS_KEY = "ddt31_user";

export function getLocalUser(): GristUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as GristUser;
  } catch { return null; }
}

export function saveLocalUser(user: GristUser) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(LS_KEY, JSON.stringify(user)); } catch { /* ignore */ }
}

/* ─────────────────────────────────────────────────────────────────
   tryDecodeJwtPayload
───────────────────────────────────────────────────────────────── */
function tryDecodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const b64  = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64));
  } catch { return null; }
}

/* ─────────────────────────────────────────────────────────────────
   fetchGristUser
   Tout client-side : postMessage ou localStorage. Pas de fetch
   cross-origin (export statique GitHub Pages).
───────────────────────────────────────────────────────────────── */
async function fetchGristUser(
  setGristUser: (u: GristUser) => void,
  docApi: GristDocAPI | null,
) {
  const gristRaw = (window as any).grist;
  const rawDocApi = gristRaw?.docApi ?? docApi;

  // ── Méthode 1 : grist.getUserProfile() — postMessage ─────────────
  if (typeof gristRaw?.getUserProfile === "function") {
    try {
      const profile = await gristRaw.getUserProfile();
      const name  = profile?.name  || profile?.email || "";
      const email = profile?.email || "";
      if (name) { setGristUser({ name, email }); return; }
    } catch { /* ignore */ }
  }

  // ── Méthode 2 : JWT payload (name/email directs) ──────────────────
  if (typeof rawDocApi?.getAccessToken === "function") {
    try {
      const tokenResult = await rawDocApi.getAccessToken({ readOnly: true });
      const { token } = tokenResult ?? {};
      if (token) {
        const payload = tryDecodeJwtPayload(token);
        const name  = payload?.name  || payload?.email || payload?.sub || "";
        const email = payload?.email || "";
        if (name) { setGristUser({ name, email }); return; }
        // JWT sans name/email → on abandonne silencieusement cette méthode
      }
    } catch { /* ignore */ }
  }

  // ── Méthode 3 : localStorage (saisie manuelle précédente) ─────────
  const local = getLocalUser();
  if (local?.name) { setGristUser(local); return; }

  // → null : le composant UserBadge proposera la saisie manuelle
}

/* ─────────────────────────────────────────────────────────────────
   useGristInit
───────────────────────────────────────────────────────────────── */
export function useGristInit(opts?: { requiredAccess?: "read table" | "full" }) {
  const [mode, setMode]           = useState<"boot" | "grist" | "mock" | "rest" | "none">("boot");
  const [docApi, setDocApi]       = useState<GristDocAPI | null>(null);
  const [gristUser, setGristUser] = useState<GristUser | null>(null);

  /** Enregistre un nom saisi manuellement (localStorage + state). */
  const setLocalUser = useCallback((name: string) => {
    const u: GristUser = { name, email: "" };
    saveLocalUser(u);
    setGristUser(u);
  }, []);

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
          fetchGristUser(setGristUser, result.docApi);
        } else {
          // Hors iframe Grist : tente quand même le localStorage
          const local = getLocalUser();
          if (local?.name) setGristUser(local);
        }
      } catch {
        setMode("none");
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { mode, docApi, gristUser, setLocalUser };
}
