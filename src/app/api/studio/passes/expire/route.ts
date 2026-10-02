import { NextResponse } from "next/server";
import { expireDuePasses } from "@/lib/studio/pass-server";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

/**
 * Proses pass yang lewat masa berlaku: sisa kredit + nilai facility diakui
 * sebagai revenue (breakage). Dipicu manual dari halaman Member Pass; nanti
 * bisa dijadwalkan harian.
 */
export async function POST() {
  return studioRoute("passes expire", async () => {
    const ctx = await requireStudioContext("update");
    const res = await expireDuePasses(ctx);
    const rupiah = res.recognized.toLocaleString("id-ID");
    return NextResponse.json({
      success: true,
      data: res,
      message: res.expired ? `${res.expired} pass kedaluwarsa · Rp ${rupiah} diakui sebagai revenue` : "Tidak ada pass yang perlu diproses",
    });
  });
}
