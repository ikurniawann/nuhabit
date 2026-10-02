import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { requireMemberStudio } from "@/lib/studio/member-server";
import { createPassOrder, loadMemberOrders } from "@/lib/studio/order-server";
import { memberOrderSchema } from "@/lib/studio/schemas";
import { studioRoute } from "@/lib/studio/server";

export async function GET() {
  return studioRoute("member orders GET", async () => {
    const { customerId } = await requireMemberStudio();
    return NextResponse.json({ success: true, data: await loadMemberOrders(customerId) });
  });
}

/** Buat pesanan paket + instruksi bayar (QRIS / Virtual Account / kartu). */
export async function POST(request: NextRequest) {
  return studioRoute("member orders POST", async () => {
    const { customerId, actor } = await requireMemberStudio();
    const b = await validateBody(request, memberOrderSchema);
    return NextResponse.json({ success: true, data: await createPassOrder(actor, customerId, b.product_id, b.method, b.bank ?? null) }, { status: 201 });
  });
}
