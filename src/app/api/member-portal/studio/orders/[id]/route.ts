import { NextRequest, NextResponse } from "next/server";
import { requireMemberStudio } from "@/lib/studio/member-server";
import { refreshPassOrder } from "@/lib/studio/order-server";
import { studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

/** Status pesanan (dicek ke Xendit bila masih menunggu pembayaran). */
export async function GET(_request: NextRequest, { params }: Params) {
  return studioRoute("member order GET", async () => {
    const { customerId } = await requireMemberStudio();
    const { id } = await params;
    return NextResponse.json({ success: true, data: await refreshPassOrder(id, customerId) });
  });
}
