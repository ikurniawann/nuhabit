import { NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { listOnlineLiveSessions } from "@/lib/recruitment/live-monitor";

/**
 * GET /api/recruitment/live-monitoring: sesi psikotes/interview yang sedang
 * berjalan DAN online, utk halaman thumbnail Live Monitoring.
 */
export const GET = apiHandler(async () => {
  await requireIamMenuPrefix(IAM.hrisRecruitment);
  return NextResponse.json({ data: await listOnlineLiveSessions() });
}, "live-monitoring");
