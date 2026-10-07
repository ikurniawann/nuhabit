import type { NextRequest } from "next/server";
import { ApiError, successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { requireCrmUser } from "@/lib/crm/guards";
import {
  loadMemberActivity,
  MEMBER_ACTIVITY_TABS,
  requireMemberCustomerId,
  type MemberActivityTab,
} from "@/lib/crm/member-detail-server";

/** GET ?tab=checkins|bookings|challenges|notifications|wallet — 100 baris terbaru. */
export const GET = apiHandler(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  await requireCrmUser("memberRead");
  const tab = request.nextUrl.searchParams.get("tab") as MemberActivityTab;
  if (!MEMBER_ACTIVITY_TABS.includes(tab)) throw ApiError.badRequest("Tab tidak dikenal");
  const customerId = await requireMemberCustomerId((await params).id);
  return successResponse(await loadMemberActivity(customerId, tab));
}, "crm.members.[id].activity.GET");
