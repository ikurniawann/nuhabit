import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { loadCommissionSettings, saveCommissionSettings } from "@/lib/studio/commission-server";
import { commissionSettingsSchema } from "@/lib/studio/schemas";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

const PREFIX = ["studio.commissions"];

export async function GET() {
  return studioRoute("commission settings GET", async () => {
    const ctx = await requireStudioContext(undefined, PREFIX);
    return NextResponse.json({ success: true, data: await loadCommissionSettings(ctx.branchId) });
  });
}

export async function PATCH(request: NextRequest) {
  return studioRoute("commission settings PATCH", async () => {
    const ctx = await requireStudioContext("update", PREFIX);
    const b = await validateBody(request, commissionSettingsSchema);
    return NextResponse.json({ success: true, data: await saveCommissionSettings(ctx.branchId, b, ctx.user.id), message: "Skema komisi disimpan" });
  });
}
