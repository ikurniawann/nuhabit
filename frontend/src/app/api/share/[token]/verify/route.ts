import { NextRequest, NextResponse } from "next/server";
import { OTP_ENABLED, OTP_UNAVAILABLE_MESSAGE } from "@/lib/otp-availability";
import { checkRateLimit } from "@/lib/rate-limit";
import { isSecureRequest } from "@/lib/auth/secure-cookie";
import { resolveShareContext } from "@/lib/dataroom/api";
import {
  isEmailAllowed, logShareAccess, pendingSteps, sessionCookieName, SHARE_PIN_POLICY, SHARE_PIN_SCOPE,
  upsertSession, verifyEmailCode, verifyPin,
} from "@/lib/dataroom/shares";
import { clearFailures, findActiveLock, minutesUntil, recordFailure } from "@/lib/security/attempt-limit";
import { clientIp } from "@/lib/security/client-ip";

/**
 * POST /api/share/[token]/verify { email?, code?, pin? } — tukar kode email
 * dan/atau PIN menjadi sesi (cookie httpOnly). Kedua langkah bisa dikirim
 * sekaligus; yang sudah lolos di sesi tidak diminta lagi.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ctx = await resolveShareContext(request, token);
  if (!ctx.ok) return NextResponse.json({ success: false, error: ctx.error }, { status: ctx.status });
  const { share, session, steps } = ctx;
  if (steps.needEmail && !OTP_ENABLED) return NextResponse.json({ success: false, error: OTP_UNAVAILABLE_MESSAGE }, { status: 503 });
  const ip = clientIp(request);
  const ua = request.headers.get("user-agent");
  if (!checkRateLimit(`dataroom-verify:${token}:${ip}`, 10).allowed) {
    return NextResponse.json({ success: false, error: "Terlalu banyak percobaan. Coba lagi sebentar." }, { status: 429 });
  }
  const body = await request.json().catch(() => ({}));
  const email = String(body?.email ?? session?.email ?? "").trim().toLowerCase();
  const code = String(body?.code ?? "").trim();
  const pin = String(body?.pin ?? "").trim();

  let emailOk = false;
  if (steps.needEmail) {
    if (!email || !isEmailAllowed(share.allowed_emails, email)) {
      return NextResponse.json({ success: false, error: "Email tidak termasuk penerima link" }, { status: 403 });
    }
    if (!code) return NextResponse.json({ success: false, error: "Masukkan kode verifikasi" }, { status: 400 });
    const result = await verifyEmailCode(share.id, email, code);
    if (result !== "ok") {
      await logShareAccess({ shareId: share.id, action: "code_failed", email, ip, userAgent: ua });
      const msg = result === "expired" ? "Kode sudah kedaluwarsa, minta kode baru"
        : result === "too_many" ? "Terlalu banyak percobaan, minta kode baru"
        : result === "missing" ? "Minta kode verifikasi terlebih dahulu" : "Kode salah";
      return NextResponse.json({ success: false, error: msg }, { status: 400 });
    }
    emailOk = true;
  }

  let pinOk = false;
  if (steps.needPin) {
    if (!pin) {
      // Email lolos tapi PIN belum diisi → simpan progres email, minta PIN.
      if (emailOk) {
        const s = await upsertSession({ existing: session, shareId: share.id, shareExpiresAt: share.expires_at, email, emailOk: true, ip, userAgent: ua });
        const res = NextResponse.json({ success: true, data: { steps: pendingSteps(share, s), verified: false } });
        setCookie(request, res, share.token, s.session_token, s.expires_at);
        return res;
      }
      return NextResponse.json({ success: false, error: "Masukkan PIN" }, { status: 400 });
    }
    // Penghitung gagal per link di DB: bertahan saat restart dan tidak bisa
    // diakali dengan berganti IP.
    const pinSubjects = [`share:${share.id}`];
    const lock = await findActiveLock(SHARE_PIN_SCOPE, pinSubjects);
    const pinValid = !lock && (await verifyPin(pin, share.pin_hash as string));
    if (!pinValid) {
      const lockedUntil = lock ?? (await recordFailure(SHARE_PIN_SCOPE, pinSubjects, SHARE_PIN_POLICY));
      if (!lock) await logShareAccess({ shareId: share.id, action: "pin_failed", email: email || null, ip, userAgent: ua });
      const error = lockedUntil
        ? `Terlalu banyak percobaan PIN. Coba lagi dalam ${minutesUntil(lockedUntil, new Date())} menit.`
        : "PIN salah";
      const status = lockedUntil ? 429 : 400;
      if (emailOk) {
        const s = await upsertSession({ existing: session, shareId: share.id, shareExpiresAt: share.expires_at, email, emailOk: true, ip, userAgent: ua });
        const res = NextResponse.json({ success: false, error, data: { steps: pendingSteps(share, s) } }, { status });
        setCookie(request, res, share.token, s.session_token, s.expires_at);
        return res;
      }
      return NextResponse.json({ success: false, error }, { status });
    }
    await clearFailures(SHARE_PIN_SCOPE, pinSubjects);
    pinOk = true;
  }

  const s = await upsertSession({
    existing: session, shareId: share.id, shareExpiresAt: share.expires_at,
    email: email || null, emailOk, pinOk, ip, userAgent: ua,
  });
  const nextSteps = pendingSteps(share, s);
  const verified = !nextSteps.needEmail && !nextSteps.needPin;
  if (verified && (emailOk || pinOk)) {
    await logShareAccess({ shareId: share.id, action: "verified", email: s.email, ip, userAgent: ua });
  }
  const res = NextResponse.json({ success: true, data: { steps: nextSteps, verified } });
  setCookie(request, res, share.token, s.session_token, s.expires_at);
  return res;
}

function setCookie(request: NextRequest, res: NextResponse, shareToken: string, sessionToken: string, expiresAt: string) {
  res.cookies.set(sessionCookieName(shareToken), sessionToken, {
    httpOnly: true, sameSite: "lax", secure: isSecureRequest(request),
    path: "/", expires: new Date(expiresAt),
  });
}
