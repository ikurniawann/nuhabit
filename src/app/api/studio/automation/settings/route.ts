import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { saveJobSettings } from "@/lib/studio/jobs-server";
import { jobSettingsSchema } from "@/lib/studio/schemas";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

export async function PATCH(request: NextRequest) {
  return studioRoute("automation settings PATCH", async () => {
    const ctx = await requireStudioContext("update", ["studio.automation"]);
    const b = await validateBody(request, jobSettingsSchema);
    const data = await saveJobSettings(ctx.branchId, b, ctx.user.id);
    return NextResponse.json({ success: true, data, message: "Pengaturan otomasi disimpan" });
  });
}
