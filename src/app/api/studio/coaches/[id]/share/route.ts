import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { query } from "@/lib/db";
import { coachShareSchema as commissionShareSchema } from "@/lib/studio/schemas";
import { assertInBranch, requireStudioContext, studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

/** Override persentase komisi satu coach (null = ikut peran). */
export async function PUT(request: NextRequest, { params }: Params) {
  return studioRoute("coach share PUT", async () => {
    const ctx = await requireStudioContext("update", ["studio.commissions"]);
    const { id } = await params;
    const b = await validateBody(request, commissionShareSchema);
    await assertInBranch("coaches", id, ctx.branchId, "Coach");
    await query(`UPDATE studio.coaches SET commission_share_percent = $2, updated_at = now() WHERE id = $1`, [id, b.commission_share_percent]);
    return NextResponse.json({ success: true, message: b.commission_share_percent === null ? "Persentase kembali ikut peran" : `Persentase coach diatur ${b.commission_share_percent}%` });
  });
}
