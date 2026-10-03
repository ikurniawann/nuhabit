import type { NextRequest } from "next/server";
import { crmFail, crmOk, crmRoute } from "@/lib/crm/crm-route";
import {
  loadMemberActivity,
  MEMBER_ACTIVITY_TABS,
  MEMBER_READ_MENUS,
  resolveCustomerId,
  type MemberActivityTab,
} from "@/lib/crm/member-detail-server";

/** GET ?tab=checkins|bookings|challenges|notifications|wallet — 100 baris terbaru. */
export const GET = crmRoute(
  MEMBER_READ_MENUS,
  "Gagal memuat aktivitas member",
  async (_userId, request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const tab = request.nextUrl.searchParams.get("tab") as MemberActivityTab;
    if (!MEMBER_ACTIVITY_TABS.includes(tab)) return crmFail("Tab tidak dikenal");
    const customerId = await resolveCustomerId((await params).id);
    if (!customerId) return crmFail("Member tidak ditemukan", 404);
    return crmOk(await loadMemberActivity(customerId, tab));
  }
);
