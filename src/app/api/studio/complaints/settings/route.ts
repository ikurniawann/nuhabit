import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { listComplaintAssignees, loadComplaintSettings, saveComplaintSettings } from "@/lib/studio/complaints-server";
import { complaintSettingsSchema } from "@/lib/studio/schemas";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

const MENU = ["studio.complaints"] as const;

/** Batas waktu per kategori + PIC default, dan daftar calon PIC. */
export async function GET() {
  return studioRoute("complaint settings GET", async () => {
    const ctx = await requireStudioContext(undefined, MENU);
    const [settings, assignees] = await Promise.all([loadComplaintSettings(ctx.branchId), listComplaintAssignees(ctx.branchId)]);
    return NextResponse.json({ success: true, data: { settings, assignees } });
  });
}

/** Perubahan berlaku untuk tiket baru; tiket lama memakai batas waktu saat dibuat. */
export async function PATCH(request: NextRequest) {
  return studioRoute("complaint settings PATCH", async () => {
    const ctx = await requireStudioContext("update", MENU);
    const b = await validateBody(request, complaintSettingsSchema);
    const data = await saveComplaintSettings(ctx.branchId, b, ctx.user.id);
    return NextResponse.json({ success: true, data, message: "Pengaturan keluhan disimpan" });
  });
}
