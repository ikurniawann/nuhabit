import { NextResponse } from "next/server";
import { sopTemplate } from "@/lib/studio/sop-server";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

/** Template SOP coach berisi angka dari pengaturan venue yang berlaku sekarang. */
export async function GET() {
  return studioRoute("sop template", async () => {
    const ctx = await requireStudioContext(undefined, ["studio.sop"]);
    return NextResponse.json({ success: true, data: await sopTemplate(ctx.branchId) });
  });
}
