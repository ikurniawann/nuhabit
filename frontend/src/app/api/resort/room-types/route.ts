import { NextResponse, type NextRequest } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { createRoomType, listRoomTypesWithSeasons } from "@/lib/resort/catalog-server";
import { roomTypeCreateSchema } from "@/lib/resort/schemas";
import { requireResortContext } from "@/lib/resort/server";

/** GET /api/resort/room-types — master tipe kamar + jumlah unit + musim tarif. */
export const GET = apiHandler(async (request: NextRequest) => {
  const ctx = await requireResortContext();
  const includeInactive = request.nextUrl.searchParams.get("all") === "1";
  return NextResponse.json({ success: true, data: await listRoomTypesWithSeasons(ctx.branchId, includeInactive) });
}, "resort.room-types.GET");

/** POST /api/resort/room-types — tambah tipe kamar. */
export const POST = apiHandler(async (request: NextRequest) => {
  const ctx = await requireResortContext("create");
  const body = await validateBody(request, roomTypeCreateSchema);
  const data = await createRoomType(ctx, body);
  return NextResponse.json({ success: true, data, message: `Tipe kamar ${body.name} dibuat` }, { status: 201 });
}, "resort.room-types.POST");
