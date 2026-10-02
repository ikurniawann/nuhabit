import { NextRequest, NextResponse } from "next/server";
import { searchLoyaltyMembers } from "@/lib/studio/loyalty-server";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

/** Cari member + data loyalitas; tanpa q = daftar member diblokir/banned. */
export async function GET(request: NextRequest) {
  return studioRoute("loyalty members GET", async () => {
    await requireStudioContext(undefined, ["studio.loyalty"]);
    return NextResponse.json({ success: true, data: await searchLoyaltyMembers(request.nextUrl.searchParams.get("q") ?? "") });
  });
}
