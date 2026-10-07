import { NextResponse, type NextRequest } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { createRoom, listRooms } from "@/lib/resort/catalog-server";
import { roomCreateSchema } from "@/lib/resort/schemas";
import { requireResortContext } from "@/lib/resort/server";

/** GET /api/resort/rooms — unit kamar + status housekeeping + tamu yang menempati. */
export const GET = apiHandler(async (request: NextRequest) => {
  const ctx = await requireResortContext();
  const rooms = await listRooms(ctx.branchId, request.nextUrl.searchParams.get("room_type_id"));
  return NextResponse.json({ success: true, data: rooms });
}, "resort.rooms.GET");

/** POST /api/resort/rooms — tambah unit kamar. */
export const POST = apiHandler(async (request: NextRequest) => {
  const ctx = await requireResortContext("create");
  const body = await validateBody(request, roomCreateSchema);
  const data = await createRoom(ctx, body);
  return NextResponse.json({ success: true, data, message: `Kamar ${body.name} dibuat` }, { status: 201 });
}, "resort.rooms.POST");
