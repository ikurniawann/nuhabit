import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { requireCoach } from "@/lib/studio/coach-portal";
import { addCoachFlag } from "@/lib/studio/member-flags-server";
import { memberFlagSchema } from "@/lib/studio/schemas";
import { studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ customerId: string }> };

/** Coach mencatat penanda (umum atau medis) untuk member yang dia ajar. */
export async function POST(request: NextRequest, { params }: Params) {
  return studioRoute("coach member flag POST", async () => {
    const { coach, userId } = await requireCoach();
    const { customerId } = await params;
    const b = await validateBody(request, memberFlagSchema);
    const id = await addCoachFlag(coach, userId, customerId, b);
    return NextResponse.json({ success: true, data: { id }, message: "Catatan tersimpan" }, { status: 201 });
  });
}
