import { NextRequest, NextResponse } from "next/server";
import { OTP_ENABLED, OTP_UNAVAILABLE_MESSAGE } from "@/lib/otp-availability";
import { clientIp } from "@/lib/security/client-ip";
import { checkRateLimit } from "@/lib/rate-limit";
import { isValidEmail } from "@/lib/dataroom/config";
import { resolveShareContext } from "@/lib/dataroom/api";
import { isEmailAllowed, issueEmailCode, logShareAccess } from "@/lib/dataroom/shares";
import { sendShareCode } from "@/lib/dataroom/mail";

/** POST /api/share/[token]/request-code { email } — kirim kode 6 digit ke email penerima. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (!OTP_ENABLED) return NextResponse.json({ success: false, error: OTP_UNAVAILABLE_MESSAGE }, { status: 503 });
  const { token } = await params;
  const ctx = await resolveShareContext(request, token);
  if (!ctx.ok) return NextResponse.json({ success: false, error: ctx.error }, { status: ctx.status });
  if (ctx.share.access_type !== "email") {
    return NextResponse.json({ success: false, error: "Link ini tidak memerlukan verifikasi email" }, { status: 400 });
  }
  const ip = clientIp(request);
  if (!checkRateLimit(`dataroom-code:${token}:${ip}`, 5).allowed) {
    return NextResponse.json({ success: false, error: "Terlalu banyak permintaan. Coba lagi sebentar." }, { status: 429 });
  }
  const body = await request.json().catch(() => ({}));
  const email = String(body?.email ?? "").trim().toLowerCase();
  if (!isValidEmail(email)) return NextResponse.json({ success: false, error: "Email tidak valid" }, { status: 400 });
  if (!isEmailAllowed(ctx.share.allowed_emails, email)) {
    await logShareAccess({ shareId: ctx.share.id, action: "code_failed", email, ip, userAgent: request.headers.get("user-agent") });
    return NextResponse.json({ success: false, error: "Email ini tidak termasuk penerima link" }, { status: 403 });
  }
  const code = await issueEmailCode(ctx.share.id, email);
  const sent = await sendShareCode(email, code, ctx.root.name);
  await logShareAccess({ shareId: ctx.share.id, action: "code_sent", email, ip, userAgent: request.headers.get("user-agent") });
  if (!sent && process.env.NODE_ENV === "production") {
    return NextResponse.json({ success: false, error: "Gagal mengirim email. Hubungi pengirim link." }, { status: 502 });
  }
  return NextResponse.json({ success: true, data: { sent: true } });
}
