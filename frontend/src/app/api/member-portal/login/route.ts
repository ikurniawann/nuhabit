import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import {
  createMemberSession,
  MEMBER_SESSION_COOKIE,
  memberSessionCookieOptions,
} from "@/lib/member-portal/session";
import { findMemberByPhone } from "@/lib/member-portal/otp-store";
import { normalizePhoneDigits } from "@/lib/member-portal/otp";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const username = body.username?.trim();
    // const password = body.password?.trim(); // Abaikan password sementara krn pos_customers tidak memiliki kolom password

    if (!username) {
      return NextResponse.json({ success: false, error: "Username wajib diisi" }, { status: 400 });
    }

    const pool = getPool();
    const phone = normalizePhoneDigits(username);
    
    // Coba temukan berdasar nomor HP dulu
    let customer = await findMemberByPhone(pool, phone || username);
    let foundId = customer?.id;
    let foundName = customer?.name;

    // Jika tidak ditemukan, coba cari by email, name, or raw phone
    if (!foundId) {
       const res = await pool.query(
         `SELECT id, name FROM pos.pos_customers WHERE (email = $1 OR name = $1 OR phone = $1) AND is_active IS NOT FALSE LIMIT 1`,
         [username]
       );
       if (res.rows.length > 0) {
         foundId = res.rows[0].id;
         foundName = res.rows[0].name;
       }
    }

    if (!foundId) {
      return NextResponse.json({ success: false, error: "Username tidak ditemukan" }, { status: 404 });
    }

    const token = await createMemberSession(foundId);
    const response = NextResponse.json({
      success: true,
      data: {
        name: foundName,
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
