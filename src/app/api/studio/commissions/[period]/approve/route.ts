import { NextRequest, NextResponse } from "next/server";
import { approvePeriod } from "@/lib/studio/commission-server";
import { periodLabel } from "@/lib/studio/commission";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ period: string }> };

export async function POST(_request: NextRequest, { params }: Params) {
  return studioRoute("commission approve", async () => {
    const ctx = await requireStudioContext("approve", ["studio.commissions"]);
    const { period } = await params;
    const view = await approvePeriod({ companyId: ctx.companyId, branchId: ctx.branchId, userId: ctx.user.id }, period);
    return NextResponse.json({
      success: true,
      data: view,
      message: `Komisi ${periodLabel(period)} disetujui · Rp ${view.allocated_amount.toLocaleString("id-ID")} untuk ${view.lines.length} coach`,
    });
  });
}
