import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { badgeSchema, catalogId, deleteBadge, listBadges, saveBadge } from "@/lib/crm/collectibles-admin-server";
import { parseCrmInput, requireCrmUser } from "@/lib/crm/guards";

/** Badge builder (EPIC-014 Task 6) — gerbang menu crm.settings. */

export const GET = apiHandler(async () => {
  await requireCrmUser("settings");
  return NextResponse.json({ success: true, data: await listBadges() });
}, "crm.badges.GET");

export const POST = apiHandler(async (request: NextRequest) => {
  await requireCrmUser("settings");
  const payload = parseCrmInput(badgeSchema, await request.json());
  return NextResponse.json({ success: true, data: await saveBadge(payload) });
}, "crm.badges.POST");

export const DELETE = apiHandler(async (request: NextRequest) => {
  await requireCrmUser("settings");
  const message = await deleteBadge(catalogId(request.nextUrl.searchParams.get("id")));
  return NextResponse.json(message ? { success: true, message } : { success: true });
}, "crm.badges.DELETE");
