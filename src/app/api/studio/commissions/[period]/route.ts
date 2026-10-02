import { NextRequest, NextResponse } from "next/server";
import { loadPeriod } from "@/lib/studio/commission-server";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

const PREFIX = ["studio.commissions"];
type Params = { params: Promise<{ period: string }> };

/** Komisi satu bulan (YYYY-MM): pratinjau langsung, atau angka terkunci bila sudah disetujui. */
export async function GET(_request: NextRequest, { params }: Params) {
  return studioRoute("commission period GET", async () => {
    const ctx = await requireStudioContext(undefined, PREFIX);
    const { period } = await params;
    return NextResponse.json({ success: true, data: await loadPeriod(ctx.branchId, period) });
  });
}
