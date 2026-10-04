import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireIamAction } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { MemberBillError, recordMemberBillPayment } from "@/lib/pos/member-bill-server";
import { checkRateLimit } from "@/lib/rate-limit";
import { isUuid } from "@/lib/table-order/server";

export const dynamic = "force-dynamic";

const schema = z.object({
  amount: z.number().int().positive().max(1_000_000_000),
  payment_method_code: z.string().trim().min(1).max(60),
  reference_number: z.string().trim().max(80).optional().nullable(),
  notes: z.string().trim().max(300).optional().nullable(),
  shift_id: z.string().uuid().optional().nullable(),
});

/**
 * POST /api/pos/member-bills/[customerId]/payments — cicilan tagihan member.
 * Nominal ≤ sisa tagihan (divalidasi ulang di server di dalam lock); bila
 * saldo menutup semua order terbuka, order-order itu langsung ditutup.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ customerId: string }> }) {
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
  const rate = checkRateLimit(`pos-member-bill:${user.id}`, 30);
  if (!rate.allowed) {
    return NextResponse.json({ success: false, error: "Terlalu banyak percobaan, coba lagi sebentar" }, { status: 429 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Data pembayaran tidak valid" }, { status: 400 });
  }

  try {
    const data = await recordMemberBillPayment({
      customerId,
      amount: parsed.data.amount,
      paymentMethodCode: parsed.data.payment_method_code,
      referenceNumber: parsed.data.reference_number,
      notes: parsed.data.notes,
      shiftId: parsed.data.shift_id,
      user: { id: user.id, name: user.full_name || "Kasir" },
    });
    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error) {
    if (error instanceof MemberBillError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error("[member-bills] payment:", error);
    return NextResponse.json({ success: false, error: "Gagal mencatat pembayaran" }, { status: 500 });
  }
}
