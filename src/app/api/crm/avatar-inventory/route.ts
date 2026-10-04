import { NextRequest, NextResponse } from "next/server";
import { ApiError, getPosSession, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import {
  equipAvatar,
  equipAvatarSchema,
  grantAvatar,
  grantAvatarSchema,
  listAvatarInventory,
} from "@/lib/crm/avatar-inventory-server";

async function requireSession() {
  if (!(await getPosSession())) throw ApiError.unauthorized();
}

export const GET = apiHandler(async (request: NextRequest) => {
  await requireSession();
  const memberId = request.nextUrl.searchParams.get("member_id");
  const customerId = request.nextUrl.searchParams.get("customer_id");
  if (!memberId && !customerId) throw ApiError.badRequest("member_id atau customer_id wajib diisi");

  const data = await listAvatarInventory({ memberId, customerId });
  return NextResponse.json({ success: true, data: data ?? [], meta: { schemaReady: data !== null } });
}, "crm.avatar-inventory.GET");

export const POST = apiHandler(async (request: NextRequest) => {
  await requireSession();
  const body = await request.json();
  // Redeem avatar dengan potong XP PENSIUN (EPIC-011 Fase B): XP adalah skor
  // seumur hidup dan tidak pernah berkurang. Avatar hanya lewat grant admin.
  if (body?.action !== "grant") {
    throw new ApiError(410, "Redeem avatar dengan XP sudah dipensiunkan — gunakan grant admin (EPIC-011)");
  }
  const parsed = grantAvatarSchema.safeParse(body);
  if (!parsed.success) throw ApiError.badRequest("Validation failed", parsed.error.issues);
  return NextResponse.json({ success: true, data: await grantAvatar(parsed.data) });
}, "crm.avatar-inventory.POST");

export const PATCH = apiHandler(async (request: NextRequest) => {
  await requireSession();
  const payload = await validateBody(request, equipAvatarSchema);
  return NextResponse.json({ success: true, data: await equipAvatar(payload) });
}, "crm.avatar-inventory.PATCH");
