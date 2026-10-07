import { NextResponse, type NextRequest } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { removeRoomType, updateRoomType } from "@/lib/resort/catalog-server";
import { roomTypePatchSchema } from "@/lib/resort/schemas";
import { requireResortContext } from "@/lib/resort/server";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/resort/room-types/[id] — ubah tipe kamar (tarif, kapasitas, aktif). */
export const PATCH = apiHandler(async (request: NextRequest, { params }: Ctx) => {
  const ctx = await requireResortContext("update");
  const { id } = await params;
  const body = await validateBody(request, roomTypePatchSchema);
  const updated = await updateRoomType(ctx.branchId, id, body);
  if (!updated) return NextResponse.json({ success: true, data: { id } });
  return NextResponse.json({ success: true, data: updated, message: "Tipe kamar diperbarui" });
}, "resort.room-types.id.PATCH");

/** DELETE /api/resort/room-types/[id] — nonaktifkan (soft) bila sudah pernah dipakai. */
export const DELETE = apiHandler(async (_request: NextRequest, { params }: Ctx) => {
  const ctx = await requireResortContext("delete");
  const { id } = await params;
  return NextResponse.json({ success: true, message: await removeRoomType(ctx.branchId, id) });
}, "resort.room-types.id.DELETE");
