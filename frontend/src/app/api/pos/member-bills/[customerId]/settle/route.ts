import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamAction } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { MemberBillError, settleMemberBillFromCredit } from "@/lib/pos/member-bill-server";
import { isUuid } from "@/lib/table-order/server";

export const dynamic = "force-dynamic";

/** POST /api/pos/member-bills/[customerId]/settle — tutup order dari saldo cicilan. */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ customerId: string }> }) {
  let user;
  try {
    user = await requireIamAction(IAM.posMemberBills, "create");
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    throw error;
  }
  const { customerId } = await params;
  if (!isUuid(customerId)) {
    return NextResponse.json({ success: false, error: "Member tidak valid" }, { status: 400 });
  }
  try {
    const data = await settleMemberBillFromCredit(customerId, { id: user.id, name: user.full_name || "Kasir" });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (error instanceof MemberBillError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error("[member-bills] settle:", error);
    return NextResponse.json({ success: false, error: "Gagal menutup tagihan" }, { status: 500 });
  }
}
