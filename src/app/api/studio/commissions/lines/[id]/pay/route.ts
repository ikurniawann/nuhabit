import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { payLine } from "@/lib/studio/commission-server";
import { commissionPaySchema } from "@/lib/studio/schemas";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

/** Catat pencairan komisi satu coach (di luar payroll). */
export async function POST(request: NextRequest, { params }: Params) {
  return studioRoute("commission pay", async () => {
    const ctx = await requireStudioContext("approve", ["studio.commissions"]);
    const { id } = await params;
    const b = await validateBody(request, commissionPaySchema);
    const line = await payLine({ companyId: ctx.companyId, branchId: ctx.branchId, userId: ctx.user.id }, id, b);
    return NextResponse.json({ success: true, message: `Komisi ${line.coach_name} Rp ${line.amount.toLocaleString("id-ID")} dibayar` });
  });
}
