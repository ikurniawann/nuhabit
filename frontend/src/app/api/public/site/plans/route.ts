import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/public/site/plans?branch= dilayani Go (modul gym-credits) lewat
 * proxy. Rute ini hanya menjaga manifes proxy tetap lengkap; tanpa
 * BACKEND_URL daftar harga publik belum tersedia.
 */
export async function GET() {
  return NextResponse.json({ success: false, error: "Daftar harga belum tersedia" }, { status: 503 });
}
