import { NextRequest, NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { markAnnouncementRead } from "@/lib/hris/announcements-repo";
import { getWorkforceActor } from "@/lib/hris/workforce-auth";
import { requireUuid } from "@/lib/hris/workforce-route";

/** POST /api/hris/announcements/[id]/read — tandai dibaca oleh karyawan login (idempoten). */

interface RouteParams {
  params: Promise<{ id: string }>;
}

export const POST = apiHandler(async (_req: NextRequest, { params }: RouteParams) => {
  const actor = await getWorkforceActor();
  if (!actor?.employeeId) throw ApiError.forbidden("Akun tidak tertaut karyawan");
  const id = requireUuid((await params).id);
  await markAnnouncementRead(id, actor.employeeId);
  return NextResponse.json({ ok: true });
}, "hris/announcements/read POST");
