import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { loadSettings, saveSettings } from "@/lib/studio/booking-server";
import { settingsPatchSchema } from "@/lib/studio/schemas";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

export async function GET() {
  return studioRoute("settings GET", async () => {
    const ctx = await requireStudioContext();
    return NextResponse.json({ success: true, data: await loadSettings(ctx.branchId) });
  });
}

export async function PATCH(request: NextRequest) {
  return studioRoute("settings PATCH", async () => {
    const ctx = await requireStudioContext("update");
    const b = await validateBody(request, settingsPatchSchema);
    return NextResponse.json({ success: true, data: await saveSettings(ctx.branchId, b, ctx.user.id), message: "Aturan booking disimpan" });
  });
}
