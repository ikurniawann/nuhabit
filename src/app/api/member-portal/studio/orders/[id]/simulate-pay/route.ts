import { NextRequest, NextResponse } from "next/server";
import { requireMemberStudio } from "@/lib/studio/member-server";
import { simulatePayment } from "@/lib/studio/order-server";
import { studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

/** DEV saja (PAYMENT_SIMULATOR=1): anggap pembayaran pesanan ini sukses. */
export async function POST(_request: NextRequest, { params }: Params) {
  return studioRoute("member order simulate pay", async () => {
    const { customerId } = await requireMemberStudio();
    const { id } = await params;
    return NextResponse.json({ success: true, data: await simulatePayment(id, customerId) });
  });
}
