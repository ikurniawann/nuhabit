import { NextResponse, type NextRequest } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { createReservation, listReservations } from "@/lib/resort/reservations-server";
import { reservationCreateSchema } from "@/lib/resort/schemas";
import { requireResortContext } from "@/lib/resort/server";

/** GET /api/resort/reservations?status&from&to&search — daftar reservasi. */
export const GET = apiHandler(async (request: NextRequest) => {
  const ctx = await requireResortContext();
  const sp = request.nextUrl.searchParams;
  const rows = await listReservations(ctx.branchId, {
    status: sp.get("status"),
    from: sp.get("from"),
    to: sp.get("to"),
    search: (sp.get("search") || "").trim(),
  });
  return NextResponse.json({ success: true, data: rows });
}, "resort.reservations.GET");

/**
 * POST /api/resort/reservations — buat reservasi: hitung tarif per malam
 * (snapshot), cek ketersediaan per tipe, dan catat tagihan kamar ke folio.
 */
export const POST = apiHandler(async (request: NextRequest) => {
  const ctx = await requireResortContext("create");
  const body = await validateBody(request, reservationCreateSchema);
  const { data, message } = await createReservation(ctx, body);
  return NextResponse.json({ success: true, data, message }, { status: 201 });
}, "resort.reservations.POST");
