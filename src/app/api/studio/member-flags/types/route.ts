import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { createFlagType } from "@/lib/studio/member-flags-server";
import { flagTypeCreateSchema } from "@/lib/studio/schemas";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

/** Tambah jenis penanda (umum atau medis). */
export async function POST(request: NextRequest) {
  return studioRoute("member-flag types POST", async () => {
    await requireStudioContext("update", ["studio.member-flags"]);
    const b = await validateBody(request, flagTypeCreateSchema);
    const data = await createFlagType(b.label, b.category);
    return NextResponse.json({ success: true, data, message: "Jenis penanda ditambahkan" }, { status: 201 });
  });
}
