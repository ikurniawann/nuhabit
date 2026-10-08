import { NextRequest, NextResponse } from "next/server";
import { OTP_ENABLED, OTP_UNAVAILABLE_MESSAGE } from "@/lib/otp-availability";
import { getPool } from "@/lib/db";
import { canBypassOtp } from "@/lib/member-portal/dev-bypass";
import { normalizePhoneDigits } from "@/lib/member-portal/otp";
import { consumeOtp, findMemberByPhone, memberIpAllowed, TOO_MANY_FROM_IP } from "@/lib/member-portal/otp-store";
import {
  createMemberSession,
  MEMBER_SESSION_COOKIE,
  memberSessionCookieOptions,
} from "@/lib/member-portal/session";

/**
 * POST /api/member-portal/verify { phone, code } — verifikasi OTP →
 * buat sesi member (cookie member_session) + stempel wa_verified_at.
 *
 * EPIC-044 (mobile app): klien app mengirim header `x-app-client: 1` →
 * token sesi juga dikembalikan di body JSON untuk disimpan di SecureStore
 * (cookie httpOnly tidak berguna bagi klien native). Portal web TIDAK mengirim
 * header itu dan tetap menerima jawaban lama tanpa token di body.
 */
export async function POST(request: NextRequest) {
  if (!OTP_ENABLED) return NextResponse.json({ success: false, error: OTP_UNAVAILABLE_MESSAGE }, { status: 503 });
  try {
    const body = await request.json().catch(() => ({}));
    const phone = normalizePhoneDigits(body.phone);
    const code = String(body.code ?? "").trim();

    /* Bypass dev lokal (lihat lib/member-portal/dev-bypass): melewati
     * pemeriksaan record OTP, kode boleh kosong. TIDAK melewati pencarian
     * member: nomor yang bukan member tetap ditolak. Mati total di produksi.
     * Dievaluasi sebelum validasi format karena kode kosong itu sah di sini. */
    const devBypass = canBypassOtp(code);

    if (!phone || (!devBypass && !/^\d{6}$/.test(code))) {
      return NextResponse.json({ success: false, error: "Nomor/kode tidak valid" }, { status: 400 });
    }

    const pool = getPool();
    if (devBypass) {
      console.warn(`[member-portal] OTP dev bypass dipakai untuk ${phone}`);
    } else {
      if (!memberIpAllowed("verify", request)) {
        return NextResponse.json({ success: false, error: TOO_MANY_FROM_IP.error }, { status: TOO_MANY_FROM_IP.status });
      }
      const otp = await consumeOtp(pool, phone, code);
      if (!otp.ok) return NextResponse.json({ success: false, error: otp.error }, { status: otp.status });
    }

    const customer = await findMemberByPhone(pool, phone);
    if (!customer) {
      return NextResponse.json({ success: false, error: "Member tidak ditemukan" }, { status: 404 });
    }

    await pool.query(
      `UPDATE pos.pos_customers
       SET wa_verified_at = COALESCE(wa_verified_at, now()), updated_at = now()
       WHERE id = $1`,
      [customer.id]
    );

    const token = await createMemberSession(customer.id);
    const response = NextResponse.json({
      success: true,
      data: {
        name: customer.name,
        ...(request.headers.get("x-app-client") === "1" ? { token } : {}),
      },
    });
    response.cookies.set(MEMBER_SESSION_COOKIE, token, memberSessionCookieOptions(request));
    return response;
  } catch (error) {
    console.error("Error verifying member OTP:", error);
    return NextResponse.json({ success: false, error: "Gagal verifikasi OTP" }, { status: 500 });
  }
}
