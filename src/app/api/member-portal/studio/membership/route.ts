import { NextResponse } from "next/server";
import { memberMembership } from "@/lib/studio/membership-server";
import { requireMemberStudio } from "@/lib/studio/member-server";
import { studioRoute } from "@/lib/studio/server";

/** Membership member (EPIC-069): tier dari spending 12 bulan, sisa ke tier berikutnya, perks, tangga tier. */
export async function GET() {
  return studioRoute("member membership", async () => {
    const { customerId } = await requireMemberStudio();
    return NextResponse.json({ success: true, data: await memberMembership(customerId) });
  });
}
