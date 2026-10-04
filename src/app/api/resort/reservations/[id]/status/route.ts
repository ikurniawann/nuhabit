import { NextResponse, type NextRequest } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { changeReservationStatus } from "@/lib/resort/front-desk-server";
import { statusChangeSchema } from "@/lib/resort/schemas";
import { requireResortContext } from "@/lib/resort/server";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/resort/reservations/[id]/status
 *   { action: 'konfirmasi' | 'check-in' | 'check-out' | 'batal' | 'no-show',
 *     assignments?: [{ reservation_room_id, room_id }], reason?, force? }
 */
export const POST = apiHandler(async (request: NextRequest, { params }: Ctx) => {
  const ctx = await requireResortContext("update");
  const { id } = await params;
  const body = await validateBody(request, statusChangeSchema);
  const { data, message } = await changeReservationStatus(ctx, id, body);
  return NextResponse.json({ success: true, data, message });
}, "resort.reservations.status.POST");
