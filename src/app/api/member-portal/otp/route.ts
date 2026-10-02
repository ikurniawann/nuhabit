import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { sendWhatsAppOtp } from "@/lib/whatsapp";
import { isDevBypassActive, memberOtpFixedCode } from "@/lib/member-portal/dev-bypass";
import {
  generateOtpCode,
  hashSecret,
  normalizePhoneDigits,
  otpMessage,
  OTP_RATE_LIMIT_COUNT,
  OTP_RATE_LIMIT_WINDOW_MS,
  OTP_TTL_MS,
} from "@/lib/member-portal/otp";

/**
 * POST /api/member-portal/otp { phone } — kirim kode OTP WhatsApp (Fonnte).
 * Hanya nomor yang TERDAFTAR sebagai member (pos_customers aktif) yang
 * dikirimi kode. Rate limit 3 permintaan / 10 menit / nomor.
 * EPIC-011 Fase D.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const phone = normalizePhoneDigits(body.phone);
    if (!phone) {
      return NextResponse.json(
        { success: false, error: "Nomor WhatsApp tidak valid" },
        { status: 400 }
      );
    }

    const pool = getPool();

    // Member lookup — nomor di DB bisa tersimpan 08xx / 62xx; cocokkan digit.
    const { rows: customers } = await pool.query(
      `SELECT id, name FROM pos.pos_customers
       WHERE is_active IS NOT FALSE
         AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g')
             IN ($1, '0' || substring($1 from 3))
       LIMIT 1`,
      [phone]
    );
    if (customers.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Nomor belum terdaftar sebagai member — daftar dulu di kasir venue kami",
        },
        { status: 404 }
      );
    }

    // Rate limit per nomor
    const { rows: recent } = await pool.query(
      `SELECT count(*)::int AS n FROM crm.member_portal_otp
       WHERE phone = $1 AND created_at > now() - ($2 || ' milliseconds')::interval`,
      [phone, OTP_RATE_LIMIT_WINDOW_MS]
    );
    if (recent[0].n >= OTP_RATE_LIMIT_COUNT) {
      return NextResponse.json(
        { success: false, error: "Terlalu banyak permintaan — coba lagi dalam 10 menit" },
        { status: 429 }
      );
    }

    // DEV ter-deploy: kode tetap, tanpa kirim WhatsApp (memberOtpFixedCode).
    const fixedCode = memberOtpFixedCode();
    const code = fixedCode ?? generateOtpCode();
    await pool.query(
      `INSERT INTO crm.member_portal_otp (phone, code_hash, expires_at)
       VALUES ($1, $2, now() + ($3 || ' milliseconds')::interval)`,
      [phone, hashSecret(code), OTP_TTL_MS]
    );

    const sent = fixedCode
      ? { success: true as const }
      : await sendWhatsAppOtp({
          target: phone,
          code,
          fallbackText: otpMessage(code),
        });
    if (!sent.success) {
      // Kode hanya boleh muncul di log NON-produksi (jalan keluar saat
      // FONNTE_API_KEY belum diisi). Di produksi log cukup mencatat
      // kegagalannya — kode OTP di log = siapa pun yang bisa membaca log
      // bisa masuk sebagai member mana pun.
      if (process.env.NODE_ENV === "production") {
        console.error(
          `[member-portal] OTP WA gagal terkirim ke ${phone} (${sent.reason})`
        );
      } else {
        console.warn(
          `[member-portal] OTP WA gagal terkirim ke ${phone} (${sent.reason}); kode utk debug dev: ${code}`
        );
      }
    }

    return NextResponse.json({
      success: true,
      message: "Kode OTP dikirim ke WhatsApp Anda",
      wa_delivered: fixedCode ? false : sent.success,
      // Dev lokal: portal melompati layar kode dan langsung verify.
      dev_bypass: isDevBypassActive(),
      // DEV ter-deploy: Member App menampilkan petunjuk kode tetap.
      ...(fixedCode ? { dev_fixed_code: fixedCode } : {}),
    });
  } catch (error) {
    console.error("Error requesting member OTP:", error);
    return NextResponse.json(
      { success: false, error: "Gagal mengirim OTP" },
      { status: 500 }
    );
  }
}
