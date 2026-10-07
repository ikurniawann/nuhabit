import { NextResponse } from "next/server";

// Lead coba gratis dilayani backend Go (crm/publicforms, POST
// /api/public/site/trial). Rute ini hanya menjawab saat BACKEND_URL tidak
// diset, supaya proxy tidak jatuh ke 404.
export function POST() {
  return NextResponse.json(
    { success: false, error: "Form coba gratis belum tersedia. Coba lagi sebentar lagi." },
    { status: 503 },
  );
}
