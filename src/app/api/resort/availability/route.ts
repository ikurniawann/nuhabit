import { NextResponse, type NextRequest } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { loadAvailability } from "@/lib/resort/reservations-server";
import { requireResortContext } from "@/lib/resort/server";

/**
 * GET /api/resort/availability?check_in&check_out[&exclude_reservation_id]
 * Ketersediaan per tipe kamar untuk rentang menginap: jumlah unit, terpakai
 * per malam, sisa minimum sepanjang rentang, unit kamar yang bebas, dan
 * penawaran harga (rincian tarif per malam) untuk 1 kamar.
 */
export const GET = apiHandler(async (request: NextRequest) => {
  const ctx = await requireResortContext();
  const sp = request.nextUrl.searchParams;
  const data = await loadAvailability(
    ctx.branchId,
    sp.get("check_in") ?? "",
    sp.get("check_out") ?? "",
    sp.get("exclude_reservation_id")
  );
  return NextResponse.json({ success: true, data });
}, "resort.availability.GET");
