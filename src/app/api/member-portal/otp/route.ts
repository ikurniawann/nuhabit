import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { isDevBypassActive } from "@/lib/member-portal/dev-bypass";
import { normalizePhoneDigits } from "@/lib/member-portal/otp";
import { findMemberByPhone, issueOtp } from "@/lib/member-portal/otp-store";

/**
 * POST /api/member-portal/otp { phone } — kirim kode OTP WhatsApp (Fonnte).
 * Hanya nomor yang TERDAFTAR sebagai member (pos_customers aktif) yang
 * dikirimi kode; nomor baru diarahkan ke pendaftaran mandiri
 * (/api/member-portal/register). Rate limit 3 permintaan / 10 menit / nomor.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const phone = normalizePhoneDigits(body.phone);
    if (!phone) {
      return NextResponse.json({ success: false, error: "Nomor WhatsApp tidak valid" }, { status: 400 });
    }

    if (!(await findMemberByPhone(getPool(), phone))) {
      return NextResponse.json(
        {
          success: false,
          error: "Nomor belum terdaftar sebagai member. Daftar dulu lewat tombol Daftar.",
          code: "not_registered",
        },
        { status: 404 }
      );
    }

    const issued = await issueOtp(phone);
    if (!issued.ok) {
      return NextResponse.json({ success: false, error: issued.error }, { status: issued.status });
    }

    return NextResponse.json({
      success: true,
      message: "Kode OTP dikirim ke WhatsApp Anda",
      wa_delivered: issued.waDelivered,
      // Dev lokal: portal melompati layar kode dan langsung verify.
      dev_bypass: isDevBypassActive(),
    });
  } catch (error) {
    console.error("Error requesting member OTP:", error);
    return NextResponse.json({ success: false, error: "Gagal mengirim OTP" }, { status: 500 });
  }
}
