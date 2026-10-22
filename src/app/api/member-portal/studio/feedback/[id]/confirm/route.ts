import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { respondToResolution } from "@/lib/studio/complaints-member-server";
import { requireMemberStudio } from "@/lib/studio/member-server";
import { memberReportConfirmSchema } from "@/lib/studio/schemas";
import { studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

/** Member mengonfirmasi laporan yang ditandai selesai, atau memintanya dibuka lagi. */
export async function POST(request: NextRequest, { params }: Params) {
  return studioRoute("member feedback confirm", async () => {
    const { customerId, actor } = await requireMemberStudio();
    const { id } = await params;
    const b = await validateBody(request, memberReportConfirmSchema);
    await respondToResolution(actor.branchId, customerId, id, b);
    return NextResponse.json({
      success: true,
      message: b.resolved ? "Thanks for confirming — this report is now closed." : "Thanks for letting us know. We've reopened it and the team will follow up.",
    });
  });
}
