import { NextRequest, NextResponse } from "next/server";
import { requirePosMenu } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { listMemberBills } from "@/lib/pos/member-bill-server";

export const dynamic = "force-dynamic";

/** GET /api/pos/member-bills?search= — member dengan tagihan terbuka / saldo cicilan. */
export async function GET(request: NextRequest) {
  const guard = await requirePosMenu(IAM.posMemberBills);
  if (guard.error) return guard.error;
  try {
    const search = (request.nextUrl.searchParams.get("search") || "").slice(0, 80);
    return NextResponse.json({ success: true, data: await listMemberBills(search) });
  } catch (error) {
    console.error("[member-bills] list:", error);
    return NextResponse.json({ success: false, error: "Gagal memuat tagihan" }, { status: 500 });
  }
}
