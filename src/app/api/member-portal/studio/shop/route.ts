import { NextResponse } from "next/server";
import { requireMemberStudio } from "@/lib/studio/member-server";
import { loadShopProducts } from "@/lib/studio/order-server";
import { studioRoute } from "@/lib/studio/server";

/** Katalog paket yang bisa dibeli online di Member App. */
export async function GET() {
  return studioRoute("member shop", async () => {
    const { actor } = await requireMemberStudio();
    return NextResponse.json({ success: true, data: await loadShopProducts(actor.branchId) });
  });
}
