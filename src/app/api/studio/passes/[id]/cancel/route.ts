import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { cancelPass } from "@/lib/studio/pass-server";
import { passCancelSchema } from "@/lib/studio/schemas";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

/** Batalkan pass yang belum dipakai (refund penuh, jurnal pembalik). */
export async function POST(request: NextRequest, { params }: Params) {
  return studioRoute("pass cancel", async () => {
    const ctx = await requireStudioContext("delete");
    const { id } = await params;
    const b = await validateBody(request, passCancelSchema);
    const pass = await cancelPass(ctx, id, b.reason);
    return NextResponse.json({ success: true, data: { id: pass.id }, message: `Pass ${pass.pass_code} dibatalkan` });
  });
}
