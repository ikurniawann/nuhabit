import { NextResponse, type NextRequest } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { removeRoom, updateRoom } from "@/lib/resort/catalog-server";
import { roomPatchSchema } from "@/lib/resort/schemas";
import { requireResortContext } from "@/lib/resort/server";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/resort/rooms/[id] — ubah kamar / status housekeeping. */
export const PATCH = apiHandler(async (request: NextRequest, { params }: Ctx) => {
  const ctx = await requireResortContext("update");
  const { id } = await params;
  const body = await validateBody(request, roomPatchSchema);
  const updated = await updateRoom(ctx.branchId, id, body);
  if (!updated) return NextResponse.json({ success: true, data: { id } });
  return NextResponse.json({ success: true, data: updated, message: "Kamar diperbarui" });
}, "resort.rooms.id.PATCH");

/** DELETE /api/resort/rooms/[id] — hapus (nonaktifkan bila pernah ditempati). */
export const DELETE = apiHandler(async (_request: NextRequest, { params }: Ctx) => {
  const ctx = await requireResortContext("delete");
  const { id } = await params;
  return NextResponse.json({ success: true, message: await removeRoom(ctx.branchId, id) });
}, "resort.rooms.id.DELETE");
