import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { setFlagTypeActive } from "@/lib/studio/member-flags-server";
import { flagTypePatchSchema } from "@/lib/studio/schemas";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

/** Aktifkan / nonaktifkan jenis penanda (penanda yang sudah ada tetap tersimpan). */
export async function PATCH(request: NextRequest, { params }: Params) {
  return studioRoute("member-flag types PATCH", async () => {
    await requireStudioContext("update", ["studio.member-flags"]);
    const { id } = await params;
    const b = await validateBody(request, flagTypePatchSchema);
    await setFlagTypeActive(id, b.is_active);
    return NextResponse.json({ success: true, message: b.is_active ? "Jenis diaktifkan" : "Jenis dinonaktifkan" });
  });
}
