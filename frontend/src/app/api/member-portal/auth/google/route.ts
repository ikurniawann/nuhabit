import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/member-portal/auth/google dilayani Go (modul member-portal)
 * lewat proxy. Rute ini hanya menjaga manifes proxy tetap lengkap; tanpa
 * BACKEND_URL masuk dengan Google belum aktif.
 */
export async function POST() {
  return NextResponse.json({ success: false, error: "Masuk dengan Google belum diaktifkan" }, { status: 503 });
}
