import { NextRequest, NextResponse } from "next/server";
import { requirePosMenu } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { getMemberBillDetail, MemberBillError } from "@/lib/pos/member-bill-server";
import { isUuid } from "@/lib/table-order/server";

export const dynamic = "force-dynamic";

/** GET /api/pos/member-bills/[customerId] — order terbuka, saldo, riwayat. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ customerId: string }> }) {
  const guard = await requirePosMenu(IAM.posMemberBills);
  if (guard.error) return guard.error;
  const { customerId } = await params;
  if (!isUuid(customerId)) {
    return NextResponse.json({ success: false, error: "Member tidak valid" }, { status: 400 });
  }
  try {
    return NextResponse.json({ success: true, data: await getMemberBillDetail(customerId) });
  } catch (error) {
    if (error instanceof MemberBillError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error("[member-bills] detail:", error);
    return NextResponse.json({ success: false, error: "Gagal memuat tagihan" }, { status: 500 });
  }
}
