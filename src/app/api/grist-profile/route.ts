// src/app/api/grist-profile/route.ts
// Proxy server-side pour contourner le CORS entre le widget (domaine Next.js)
// et l'API REST Grist (domaine self-hosted).

import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  let token: string | undefined;
  let baseUrl: string | undefined;

  try {
    const body = await request.json();
    token   = body?.token;
    baseUrl = body?.baseUrl;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  if (!token || !baseUrl) {
    return NextResponse.json({ error: "Paramètres manquants : token, baseUrl" }, { status: 400 });
  }

  // Sécurité minimale : refuser les baseUrl locales ou non-HTTPS
  try {
    const u = new URL(baseUrl);
    if (!["https:", "http:"].includes(u.protocol)) {
      return NextResponse.json({ error: "Protocol non supporté" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "baseUrl invalide" }, { status: 400 });
  }

  try {
    // Tentative 1 : Authorization Bearer
    let resp = await fetch(`${baseUrl}/api/profile`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    // Tentative 2 : query param ?auth=
    if (!resp.ok) {
      resp = await fetch(`${baseUrl}/api/profile?auth=${encodeURIComponent(token)}`);
    }

    if (!resp.ok) {
      return NextResponse.json(
        { error: `Grist a répondu ${resp.status}` },
        { status: resp.status }
      );
    }

    const profile = await resp.json();
    return NextResponse.json(profile);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
