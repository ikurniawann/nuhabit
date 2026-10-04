import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { requireCrmUser } from "@/lib/crm/guards";
import { listConversations } from "@/lib/crm/inbox-server";

/**
 * EPIC-012 Fase C — daftar percakapan inbox WhatsApp CS.
 * Gate menu inbox (isi chat = PII sensitif).
 */
export const GET = apiHandler(async (request: NextRequest) => {
  const user = await requireCrmUser("inbox");
  const params = request.nextUrl.searchParams;
  const data = await listConversations(
    {
      status: params.get("status"),
      assigned: params.get("assigned"),
      search: params.get("search"),
      channel: params.get("channel"),
    },
    user.id
  );
  return NextResponse.json({ success: true, data });
}, "crm.inbox.conversations.GET");
