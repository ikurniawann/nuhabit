import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import {
  findMemberLoginCandidate,
  memberIpAllowed,
  memberLoginAllowed,
  TOO_MANY_FROM_IP,
} from "@/lib/member-portal/otp-store";
import {
  DUMMY_PASSWORD_HASH,
  LOGIN_ACCOUNT_LIMIT_MESSAGE,
  LOGIN_INVALID_MESSAGE,
  LOGIN_NO_PASSWORD_MESSAGE,
  validateLoginInput,
} from "@/lib/member-portal/login-rules";
import {
  createMemberSession,
  MEMBER_SESSION_COOKIE,
  memberSessionCookieOptions,
} from "@/lib/member-portal/session";

/**
 * POST /api/member-portal/login { username, password }
 *
 * Login member dengan password. `username` = nomor WhatsApp ATAU email yang
 * tersimpan di pos.pos_customers (tidak ada kolom username terpisah); nama
 * sengaja TIDAK dipakai karena tidak unik.
 *
 * Sesi HANYA diterbitkan setelah hash bcrypt `pos_customers.password_hash`
 * cocok. Sebelumnya password diabaikan, sehingga sesi bisa didapat dengan
 * username saja (ditutup 2026-10-08).
 *
 * Balasan:
 *   400  username/password kosong
 *   401  akun tidak dikenal ATAU password salah (pesan seragam)
 *   403  akun ada tapi belum punya password (di-enroll kasir)
 *   429  terlalu banyak percobaan (per-IP atau per-akun)
 * 200 menyertakan `token` hanya bila header `x-app-client: 1` (klien mobile).
 */
export async function POST(request: NextRequest) {
  try {
    if (!memberIpAllowed("login", request)) {
      return NextResponse.json({ success: false, error: TOO_MANY_FROM_IP.error }, { status: TOO_MANY_FROM_IP.status });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = validateLoginInput(body);
    if (!parsed.ok) {
      return NextResponse.json(
        { success: false, error: parsed.error, field: parsed.field },
        { status: 400 }
      );
    }
    const { username, password } = parsed.value;

    if (!memberLoginAllowed(username)) {
      return NextResponse.json({ success: false, error: LOGIN_ACCOUNT_LIMIT_MESSAGE }, { status: 429 });
    }

    const pool = getPool();
    const member = await findMemberLoginCandidate(pool, username);

    // bcrypt SELALU dijalankan (hash dummy bila akun tidak ada) supaya waktu
    // respons tidak membocorkan akun mana yang terdaftar.
    const passwordOk = await verifyPassword(password, member?.password_hash ?? DUMMY_PASSWORD_HASH);

    if (!member || !passwordOk) {
      if (member && !member.password_hash) {
        return NextResponse.json(
          { success: false, error: LOGIN_NO_PASSWORD_MESSAGE },
          { status: 403 }
        );
      }
      return NextResponse.json({ success: false, error: LOGIN_INVALID_MESSAGE }, { status: 401 });
    }

    const token = await createMemberSession(member.id);
    const response = NextResponse.json({
      success: true,
      data: {
        name: member.name,
        ...(request.headers.get("x-app-client") === "1" ? { token } : {}),
      },
    });
    response.cookies.set(MEMBER_SESSION_COOKIE, token, memberSessionCookieOptions(request));
    return response;
  } catch (error) {
    console.error("Error logging in:", error);
    return NextResponse.json({ success: false, error: "Gagal login" }, { status: 500 });
  }
}
