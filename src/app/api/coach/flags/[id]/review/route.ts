import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { requireCoach } from "@/lib/studio/coach-portal";
import { reviewParqFlag } from "@/lib/studio/member-flags-server";
import { flagReviewSchema } from "@/lib/studio/schemas";
import { studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

/** Coach meninjau penanda dari PAR-Q member: konfirmasi (boleh ubah tingkat/catatan) atau hapus. */
export async function POST(request: NextRequest, { params }: Params) {
  return studioRoute("coach flag review", async () => {
    const { coach, userId } = await requireCoach();
    const { id } = await params;
    const b = await validateBody(request, flagReviewSchema);
    await reviewParqFlag(coach, userId, id, b);
    return NextResponse.json({ success: true, message: b.keep ? "Penanda dikonfirmasi" : "Penanda dihapus" });
  });
}
