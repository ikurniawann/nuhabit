import { NextResponse, type NextRequest } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { addFolioCharge } from "@/lib/resort/front-desk-server";
import { folioChargeSchema } from "@/lib/resort/schemas";
import { requireResortContext } from "@/lib/resort/server";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/resort/reservations/[id]/charges — tambah baris folio: biaya
 * (F&B, aktivitas, laundry, denda) atau pembayaran/diskon.
 */
export const POST = apiHandler(async (request: NextRequest, { params }: Ctx) => {
  const ctx = await requireResortContext("update");
  const { id } = await params;
  const body = await validateBody(request, folioChargeSchema);
  const { data, message } = await addFolioCharge(ctx, id, body);
  return NextResponse.json({ success: true, data, message }, { status: 201 });
}, "resort.reservations.charges.POST");
