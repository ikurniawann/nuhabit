import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { isDevBypassActive } from "@/lib/member-portal/dev-bypass";
import { normalizePhoneDigits } from "@/lib/member-portal/otp";
import { findMemberByPhone, issueOtp } from "@/lib/member-portal/otp-store";

/**
 * POST /api/member-portal/register/otp { phone } — langkah pertama daftar
 * mandiri: kirim OTP WhatsApp ke nomor yang BELUM terdaftar. Nomor yang sudah
 * member diarahkan ke Masuk. Rate limit sama dengan login (3 / 10 menit).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const phone = normalizePhoneDigits(body.phone);
    if (!phone) {
      return NextResponse.json({ success: false, error: "Nomor WhatsApp tidak valid" }, { status: 400 });
    }
    if (await findMemberByPhone(getPool(), phone)) {
      return NextResponse.json(
        { success: false, error: "Nomor ini sudah terdaftar. Silakan masuk.", code: "already_registered" },
        { status: 409 }
      );
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
