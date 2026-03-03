// src/lib/grist/hooks.ts
"use client";

import { useEffect, useState } from "react";
import { initGristOrMock } from "./init";
import type { GristDocAPI } from "./meta";

/* ─────────────────────────────────────────────────────────────────
   useGristInit
   Charge grist-plugin-api.js et initialise la connexion Grist.
───────────────────────────────────────────────────────────────── */
export function useGristInit(opts?: { requiredAccess?: "read table" | "full" }) {
  const [mode, setMode]     = useState<"boot" | "grist" | "mock" | "rest" | "none">("boot");
  const [docApi, setDocApi] = useState<GristDocAPI | null>(null);

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
      } catch {
        setMode("none");
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { mode, docApi };
}
