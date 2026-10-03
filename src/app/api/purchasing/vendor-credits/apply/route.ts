import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { requestMeta } from "@/lib/audit";
import { computePoInvoiceAmounts, getReturnCreditsByPoIds } from "@/lib/purchasing/po-payments";
import { getVendorCreditsByPoIds } from "@/lib/purchasing/vendor-credit-service";
import {
  CreditApplyError,
  applyVendorCredits,
  listCreditsForPo,
} from "@/lib/purchasing/vendor-credit-apply";

const applySchema = z.object({
  purchase_order_id: z.string().uuid(),
  amount: z.number().positive("Jumlah harus lebih dari 0"),
  dry_run: z.boolean().optional(),
});

/** Sisa tagihan PO setelah retur, kredit vendor, dan pembayaran (sama dengan daftar invoice). */
async function poOutstanding(poId: string): Promise<number> {
  const db = await createServerPgClient();
  const { data: row, error } = await db
    .from("v_purchase_orders")
    .select("payable_amount, paid_amount")
    .eq("id", poId)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw new CreditApplyError(404, "PO tidak ditemukan");
  const [returnCredits, vendorCredits] = await Promise.all([
    getReturnCreditsByPoIds(db, [poId]),
    getVendorCreditsByPoIds(db, [poId]),
  ]);
  return computePoInvoiceAmounts({
    grossPayable: Number(row.payable_amount || 0),
    returnCredit: returnCredits.get(poId) || 0,
    rejectCredit: vendorCredits.get(poId) || 0,
    paidAmount: Number(row.paid_amount || 0),
  }).outstanding_amount;
}

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof ApiError) return error.toResponse();
  if (error instanceof CreditApplyError) {
    return NextResponse.json({ success: false, message: error.message }, { status: error.status });
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json({ success: false, message: error.issues[0]?.message ?? "Validasi gagal" }, { status: 400 });
  }
  console.error(fallback, error);
  return NextResponse.json({ success: false, message: fallback }, { status: 500 });
}

/** GET ?purchase_order_id= — kredit pemasok PO ini dari PO lain, urutan pemakaian. */
export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.items);
    const poId = request.nextUrl.searchParams.get("purchase_order_id") ?? "";
    if (!z.string().uuid().safeParse(poId).success) {
      return NextResponse.json({ success: false, message: "purchase_order_id wajib" }, { status: 400 });
    }
    const [credits, outstanding] = await Promise.all([listCreditsForPo(poId), poOutstanding(poId)]);
    return NextResponse.json({ success: true, data: credits, meta: { outstanding } });
  } catch (error) {
    return errorResponse(error, "Gagal memuat kredit vendor");
  }
}

/**
 * POST — pakai kredit vendor (tertua dulu, yang kedaluwarsa dilewati) untuk
 * mengurangi tagihan PO. `dry_run: true` hanya menghitung alokasi.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireIamMenuPrefix(IAM.items);
    const body = applySchema.parse(await request.json());
    const outstanding = await poOutstanding(body.purchase_order_id);
    if (body.amount > outstanding + 0.01) {
      throw new CreditApplyError(400, `Jumlah melebihi sisa tagihan PO (${outstanding})`);
    }
    const result = await applyVendorCredits({
      purchaseOrderId: body.purchase_order_id,
      amount: body.amount,
      dryRun: body.dry_run,
      actor: { id: user.id, name: user.full_name },
      ...requestMeta(request),
    });
    const used = Math.round((body.amount - result.remaining) * 100) / 100;
    return NextResponse.json({
      success: true,
      data: result,
      message: body.dry_run
        ? `Kredit yang bisa dipakai: ${used}`
        : `Kredit vendor ${used} dipakai untuk PO ini`,
    });
  } catch (error) {
    return errorResponse(error, "Gagal memakai kredit vendor");
  }
}
