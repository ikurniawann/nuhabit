import { NextRequest, NextResponse } from "next/server";
import { OTP_ENABLED, OTP_UNAVAILABLE_MESSAGE } from "@/lib/otp-availability";
import { withTransaction } from "@/lib/db";
import { setMarketingConsent } from "@/lib/member-portal/consent";
import { canBypassOtp } from "@/lib/member-portal/dev-bypass";
import { consumeOtp, findMemberByPhone, memberIpAllowed, TOO_MANY_FROM_IP } from "@/lib/member-portal/otp-store";
import { validateRegistration } from "@/lib/member-portal/register";
import {
  createMemberSession,
  MEMBER_SESSION_COOKIE,
  memberSessionCookieOptions,
} from "@/lib/member-portal/session";

/**
 * POST /api/member-portal/register { phone, code, name, email?, birth_date?, wa_consent }
 *
 * Daftar mandiri dari portal: verifikasi OTP, buat pos_customers
 * (member_type 'registered') + profil CRM tier awal, lalu langsung masuk
 * dengan sesi yang sama seperti /verify. Satu transaksi dengan advisory lock
 * per nomor supaya dua permintaan bersamaan tidak membuat member ganda.
 */
export async function POST(request: NextRequest) {
  if (!OTP_ENABLED) return NextResponse.json({ success: false, error: OTP_UNAVAILABLE_MESSAGE }, { status: 503 });
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = validateRegistration(body);
    if (!parsed.ok) {
      return NextResponse.json({ success: false, error: parsed.error, field: parsed.field }, { status: 400 });
    }
    const reg = parsed.value;
    const code = String(body.code ?? "").trim();
    const devBypass = canBypassOtp(code);
    if (!devBypass && !/^\d{6}$/.test(code)) {
      return NextResponse.json({ success: false, error: "Kode harus 6 digit", field: "code" }, { status: 400 });
    }
    if (!devBypass && !memberIpAllowed("verify", request)) {
      return NextResponse.json({ success: false, error: TOO_MANY_FROM_IP.error, field: "code" }, { status: TOO_MANY_FROM_IP.status });
    }

    const result = await withTransaction(async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`member-register:${reg.phoneDigits}`]);

      // Kode dulu, baru status member: tanpa kode yang sah, jawaban tidak
      // boleh membedakan nomor member dari nomor baru.
      if (devBypass) {
        console.warn(`[member-portal] OTP dev bypass dipakai untuk daftar ${reg.phoneDigits}`);
      } else {
        const otp = await consumeOtp(client, reg.phoneDigits, code);
        if (!otp.ok) return { ...otp, field: "code" };
      }
      if (await findMemberByPhone(client, reg.phoneDigits)) {
        return { ok: false as const, status: 409, error: "Nomor ini sudah terdaftar. Silakan masuk.", field: "phone" };
      }

      const { rows } = await client.query(
        `INSERT INTO pos.pos_customers
           (phone, name, email, birth_date, member_type, wa_consent, wa_verified_at)
         VALUES ($1, $2, $3, $4, 'registered', $5, now())
         RETURNING id, name`,
        [reg.phoneLocal, reg.name, reg.email, reg.birthDate, reg.waConsent]
      );
      const customer = rows[0] as { id: string; name: string | null };

      // Profil CRM seperti pendaftaran di kasir (enroll_member): tier regular.
      await client.query(
        `INSERT INTO crm.crm_member_profiles (customer_id, tier_id, status, metadata, last_activity_at)
         SELECT $1, t.id, 'active', '{"source":"member_portal_register"}'::jsonb, now()
           FROM crm.crm_membership_tiers t
          WHERE t.code = 'regular' OR t.is_active
          ORDER BY (t.code = 'regular') DESC, t.rank
          LIMIT 1
         ON CONFLICT (customer_id) DO NOTHING`,
        [customer.id]
      );
      await setMarketingConsent(client, customer.id, reg.waConsent);
      return { ok: true as const, customer };
    });

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error, field: result.field },
        { status: result.status }
      );
    }

    const token = await createMemberSession(result.customer.id);
    const response = NextResponse.json({
      success: true,
      data: {
        name: result.customer.name,
        ...(request.headers.get("x-app-client") === "1" ? { token } : {}),
      },
    });
    response.cookies.set(MEMBER_SESSION_COOKIE, token, memberSessionCookieOptions(request));
    return response;
  } catch (error) {
    // Nomor yang sama tersimpan dalam format lain (mis. member nonaktif).
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json(
        { success: false, error: "Nomor ini sudah tercatat. Hubungi kasir untuk mengaktifkannya.", field: "phone" },
        { status: 409 }
      );
    }
    console.error("Error registering member:", error);
    return NextResponse.json({ success: false, error: "Pendaftaran gagal. Coba lagi." }, { status: 500 });
  }
}
