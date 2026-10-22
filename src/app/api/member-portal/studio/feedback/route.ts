import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { MEMBER_REPORT_DAILY_LIMIT } from "@/lib/studio/complaints";
import { createMemberReport, listMemberReports, memberRecentSessions } from "@/lib/studio/complaints-member-server";
import { requireMemberStudio } from "@/lib/studio/member-server";
import { memberReportSchema } from "@/lib/studio/schemas";
import { studioRoute } from "@/lib/studio/server";

/** Laporan saya + sesi terakhir yang bisa ditautkan (EPIC-067 T-067-B4). */
export async function GET() {
  return studioRoute("member feedback GET", async () => {
    const { customerId, actor } = await requireMemberStudio();
    const [reports, sessions] = await Promise.all([listMemberReports(actor.branchId, customerId), memberRecentSessions(actor.branchId, customerId)]);
    return NextResponse.json({ success: true, data: { reports, sessions, daily_limit: MEMBER_REPORT_DAILY_LIMIT } });
  });
}

/** Kirim laporan masalah / masukan → tiket keluhan (source Member App). */
export async function POST(request: NextRequest) {
  return studioRoute("member feedback POST", async () => {
    const { customerId, actor } = await requireMemberStudio();
    const b = await validateBody(request, memberReportSchema);
    const data = await createMemberReport(actor, customerId, b);
    const message =
      b.kind === "feedback"
        ? "Thanks for your feedback — it goes straight to our team."
        : b.category === "injury"
          ? `Report ${data.code} sent. Our coaching team has been alerted and will contact you soon. If it's an emergency, please call for help right away.`
          : `Report ${data.code} sent. We'll look into it and keep you posted here.`;
    return NextResponse.json({ success: true, data, message }, { status: 201 });
  });
}
