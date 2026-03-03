// src/lib/grist/init.ts

export type InitResult = {
  mode: "grist" | "mock" | "rest" | "none";
  grist: any | null;
  docApi: any | null;
};

export async function initGristOrMock(
  opts: {
    requiredAccess?: "read table" | "full";
    onRecord?: (rec: any, mapping?: any) => void;
    onApplyUserActions?: (actions: any[]) => void;
  } = {}
): Promise<InitResult> {
  const requiredAccess = opts.requiredAccess ?? "full";

  // --------------------------------------------------
  // 1️⃣ Mode GRIST réel (iframe)
  // --------------------------------------------------
  const grist =
    typeof window !== "undefined" ? (window as any).grist ?? null : null;

  // Grist embeds widgets dans un iframe → on vérifie qu'on y est bien.
  // Sinon (page standalone / magic link), on skip et on tombe en mode REST.
  const isInFrame = typeof window !== "undefined" && window.self !== window.top;

  if (grist?.ready && isInFrame) {
    try {
      grist.ready({ requiredAccess });
    } catch {
      // ignore
    }

    // onRecord
    if (typeof opts.onRecord === "function") {
      try {
        grist.onRecord((rec: any, mapping: any) => {
          opts.onRecord?.(rec, mapping);
        });
      } catch {
        // ignore
      }
    }

    // onApplyUserActions
    if (typeof opts.onApplyUserActions === "function") {
      try {
        if (typeof grist.onApplyUserActions === "function") {
          grist.onApplyUserActions((actions: any[]) => {
            opts.onApplyUserActions?.(actions);
          });
        }
      } catch {
        // ignore
      }
    }

    return {
      mode: "grist",
      grist,
      docApi: grist.docApi ?? null,
    };
  }

  // --------------------------------------------------
  // 2️⃣ Mode MOCK (si présent dans window)
  // --------------------------------------------------
  const mock =
    typeof window !== "undefined"
      ? (window as any).__GRIST_MOCK__ ?? null
      : null;

  if (mock?.docApi) {
    if (typeof opts.onRecord === "function") {
      try {
        mock.onRecord?.((rec: any, mapping: any) => {
          opts.onRecord?.(rec, mapping);
        });
      } catch {
        // ignore
      }
    }

    if (typeof opts.onApplyUserActions === "function") {
      try {
        mock.onApplyUserActions?.((actions: any[]) => {
          opts.onApplyUserActions?.(actions);
        });
      } catch {
        // ignore
      }
    }

    return {
      mode: "mock",
      grist: mock,
      docApi: mock.docApi,
    };
  }

  // --------------------------------------------------
  // 3️⃣ Mode REST (NEXT_PUBLIC_GRIST_PROXY_URL défini au build)
  // --------------------------------------------------
  if (process.env.NEXT_PUBLIC_GRIST_PROXY_URL) {
    const { createRestDocApi } = await import("./rest");
    return {
      mode: "rest",
      grist: null,
      docApi: createRestDocApi(),
    };
  }

  // --------------------------------------------------
  // 4️⃣ Aucun contexte Grist
  // --------------------------------------------------
  return {
    mode: "none",
    grist: null,
    docApi: null,
  };
}