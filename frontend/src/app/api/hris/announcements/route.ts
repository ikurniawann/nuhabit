import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import {
  announcementUpsertSchema,
  createAnnouncement,
  listAnnouncements,
} from "@/lib/hris/announcements-repo";
import { getWorkforceActor } from "@/lib/hris/workforce-auth";
import { readJson } from "@/lib/hris/workforce-route";

/**
 * GET  /api/hris/announcements — daftar CMS (semua status, filter ?status=)
 * POST /api/hris/announcements — buat pengumuman baru
 */

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.hrisKepegawaian);
  const status = request.nextUrl.searchParams.get("status");
  return NextResponse.json({ data: await listAnnouncements(status) });
}, "hris/announcements GET");

export const POST = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.hrisKepegawaian);
  const actor = await getWorkforceActor();
  const body = await readJson(request, announcementUpsertSchema, "Validasi gagal");
  const data = await createAnnouncement(body, actor?.employeeId ?? null);
  return NextResponse.json({ data, message: "Pengumuman berhasil dibuat" });
}, "hris/announcements POST");
