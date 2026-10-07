import { NextResponse } from "next/server";

// Jadwal kelas publik dilayani backend Go (gymscheduling, GET
// /api/public/site/sessions). Rute ini hanya menjawab saat BACKEND_URL
// tidak diset, supaya proxy tidak jatuh ke 404.
export function GET() {
  return NextResponse.json(
    { success: false, error: "Jadwal kelas belum tersedia. Coba lagi sebentar lagi." },
    { status: 503 },
  );
}
