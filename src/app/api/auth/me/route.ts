import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getSessionUserFromCookies } from "@/lib/auth/session";
import { queryOne } from "@/lib/db";

interface ProfileRow {
  id: string;
  full_name: string | null;
  role: string | null;
  brand_id: string | null;
}

/** Profil user login. Sesi tanpa baris configuration.users dianggap belum login. */
export const GET = apiHandler(async () => {
  const user = await getSessionUserFromCookies();
  if (!user) throw ApiError.unauthorized("Not authenticated");

  // Jangan select `email` dari configuration.users: kolom itu opsional, email
  // diambil dari sesi (auth.users).
  const profile = await queryOne<ProfileRow>(
    `SELECT id, full_name, role, brand_id FROM configuration.users WHERE id = $1`,
    [user.id]
  );
  if (!profile) throw ApiError.unauthorized("Not authenticated");

  return NextResponse.json({
    success: true,
    data: { ...profile, id: user.id, email: user.email ?? "" },
  });
}, "api/auth/me");
