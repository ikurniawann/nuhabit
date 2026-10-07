import { NextRequest, NextResponse } from "next/server";
import { isDevBypassActive } from "@/lib/member-portal/dev-bypass";
import { normalizePhoneDigits } from "@/lib/member-portal/otp";
import { issueOtp, memberIpAllowed, TOO_MANY_FROM_IP } from "@/lib/member-portal/otp-store";

/**
 * POST /api/member-portal/register/otp { phone } — langkah pertama daftar
 * mandiri: kirim OTP WhatsApp. Jawabannya SAMA untuk nomor member maupun
 * bukan (tidak membocorkan siapa yang sudah member); pemilik nomor yang
 * sudah terdaftar baru diberi tahu di /register setelah kodenya terbukti.
 * Rate limit sama dengan login (3 / 10 menit / nomor) plus rem per-IP.
 */
export async function POST(request: NextRequest) {
  try {
    if (!memberIpAllowed("otp", request)) {
      return NextResponse.json({ success: false, error: TOO_MANY_FROM_IP.error }, { status: TOO_MANY_FROM_IP.status });
    }
    const body = await request.json().catch(() => ({}));
    const phone = normalizePhoneDigits(body.phone);
    if (!phone) {
      return NextResponse.json({ success: false, error: "Nomor WhatsApp tidak valid" }, { status: 400 });
    }

    // Dev lokal: tidak perlu kode, jadi tidak perlu membebani rate limit.
    if (isDevBypassActive()) {
      return NextResponse.json({ success: true, wa_delivered: false, dev_bypass: true });
    }

    const issued = await issueOtp(phone);
    if (!issued.ok) {
      return NextResponse.json({ success: false, error: issued.error }, { status: issued.status });
    }
    return NextResponse.json({ success: true, wa_delivered: issued.waDelivered, dev_bypass: false });
  } catch (error) {
    console.error("Error requesting register OTP:", error);
    return NextResponse.json({ success: false, error: "Gagal mengirim OTP" }, { status: 500 });
  }
}
