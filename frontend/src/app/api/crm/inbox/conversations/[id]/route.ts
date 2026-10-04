import { NextRequest, NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { requireCrmUser } from "@/lib/crm/guards";
import {
  applyConversationAction,
  conversationActionSchema,
  loadConversationDetail,
} from "@/lib/crm/inbox-server";

/** EPIC-012 Fase C — detail percakapan (pesan + konteks member) & aksi agent. */

type Ctx = { params: Promise<{ id: string }> };

export const GET = apiHandler(async (_request: NextRequest, { params }: Ctx) => {
  await requireCrmUser("inbox");
  const { id } = await params;
  return NextResponse.json({ success: true, data: await loadConversationDetail(id) });
}, "crm.inbox.conversations.[id].GET");

export const POST = apiHandler(async (request: NextRequest, { params }: Ctx) => {
  const user = await requireCrmUser("inbox");
  const { id } = await params;
  const parsed = conversationActionSchema.safeParse(await request.json());
  if (!parsed.success) throw ApiError.badRequest("Payload tidak valid");
  const result = await applyConversationAction(id, parsed.data, user.id);
  return NextResponse.json(result ? { success: true, data: result } : { success: true });
}, "crm.inbox.conversations.[id].POST");
