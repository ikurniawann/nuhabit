import { NextRequest, NextResponse } from "next/server";
import { requireCoach } from "@/lib/studio/coach-portal";
import { removeCoachFlag } from "@/lib/studio/member-flags-server";
import { studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

/** Coach menghapus penanda yang boleh dia lihat (mis. cedera sudah pulih). */
export async function DELETE(_request: NextRequest, { params }: Params) {
  return studioRoute("coach member flag DELETE", async () => {
    const { coach, userId } = await requireCoach();
    const { id } = await params;
    await removeCoachFlag(coach, userId, id);
    return NextResponse.json({ success: true, message: "Penanda dihapus" });
  });
}
