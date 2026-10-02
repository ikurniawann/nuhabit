import { NextResponse } from "next/server";
import { requireMemberStudio } from "@/lib/studio/member-server";
import { loadPtCatalog } from "@/lib/studio/pt-server";
import { studioRoute } from "@/lib/studio/server";

/** Program Personal Training + profil coach (yang tampil di Member App). */
export async function GET() {
  return studioRoute("member pt catalog", async () => {
    const { actor } = await requireMemberStudio();
    return NextResponse.json({ success: true, data: await loadPtCatalog(actor.branchId, true) });
  });
}
