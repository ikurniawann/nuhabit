import { NextResponse, type NextRequest } from "next/server";
import { ApiError, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { updateReservation } from "@/lib/resort/reservations-server";
import { reservationPatchSchema } from "@/lib/resort/schemas";
import { requireResortContext, reservationDetail } from "@/lib/resort/server";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/resort/reservations/[id] — detail + kamar + folio + saldo. */
export const GET = apiHandler(async (_request: NextRequest, { params }: Ctx) => {
  const ctx = await requireResortContext();
  const { id } = await params;
  const detail = await reservationDetail(ctx.branchId, id);
  if (!detail) throw ApiError.notFound("Reservasi tidak ditemukan");
  return NextResponse.json({ success: true, data: detail });
}, "resort.reservations.id.GET");

/** PATCH /api/resort/reservations/[id] — ubah catatan/permintaan khusus & kontak. */
export const PATCH = apiHandler(async (request: NextRequest, { params }: Ctx) => {
  const ctx = await requireResortContext("update");
  const { id } = await params;
  const body = await validateBody(request, reservationPatchSchema);
  const updated = await updateReservation(ctx.branchId, id, body);
  if (!updated) return NextResponse.json({ success: true, data: { id } });
  return NextResponse.json({ success: true, data: updated, message: "Reservasi diperbarui" });
}, "resort.reservations.id.PATCH");
