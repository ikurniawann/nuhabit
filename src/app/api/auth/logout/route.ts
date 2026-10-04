import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clearSessionCookie, destroySession } from "@/lib/auth/session";
import { LEGACY_SESSION_COOKIE, SESSION_COOKIE } from "@/lib/auth/constants";
import { LEGACY_ACTIVE_STALL_COOKIE } from "@/lib/auth/active-stall";

/** Hapus sesi di DB untuk cookie baru maupun cookie nama lama, lalu kosongkan cookie-nya. */
async function endSession(request: Request, response: NextResponse) {
  const store = await cookies();
  const tokens = new Set(
    [SESSION_COOKIE, LEGACY_SESSION_COOKIE]
      .map((name) => store.get(name)?.value)
      .filter((token): token is string => Boolean(token))
  );
  for (const token of tokens) await destroySession(token);
  clearSessionCookie(response, request);
  response.cookies.set(LEGACY_ACTIVE_STALL_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}

export async function POST(request: Request) {
  return endSession(request, NextResponse.json({ success: true }));
}

// Dipakai requireUser() saat cookie session ada tapi tidak valid lagi —
// tanpa ini browser terjebak redirect loop /login ↔ /dashboard.
export async function GET(request: Request) {
  // Location relatif — di belakang cloudflared, request.url berisi host
  // internal (localhost:3459), bukan domain publik.
  return endSession(request, new NextResponse(null, { status: 307, headers: { Location: "/login" } }));
}
