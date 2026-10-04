import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { requestMeta } from "@/lib/audit";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { applyVendorCredits, listCreditsForPo } from "@/lib/purchasing/vendor-credit-apply";
import { getPoOutstanding } from "@/lib/purchasing/vendor-invoices";

const applySchema = z.object({
  purchase_order_id: z.string().uuid(),
  amount: z.number().positive("Jumlah harus lebih dari 0"),
  dry_run: z.boolean().optional(),
});

async function requireOutstanding(poId: string): Promise<number> {
  const outstanding = await getPoOutstanding(await createServerPgClient(), poId);
  if (outstanding === null) throw ApiError.notFound("PO tidak ditemukan");
  return outstanding;
}

/** GET ?purchase_order_id= — kredit pemasok PO ini dari PO lain, urutan pemakaian. */
export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);
  const poId = request.nextUrl.searchParams.get("purchase_order_id") ?? "";
  if (!z.string().uuid().safeParse(poId).success) {
    throw ApiError.badRequest("purchase_order_id wajib");
  }
  const [credits, outstanding] = await Promise.all([listCreditsForPo(poId), requireOutstanding(poId)]);
  return NextResponse.json({ success: true, data: credits, meta: { outstanding } });
}, "purchasing.vendor-credits.list");

/**
 * POST — pakai kredit vendor (tertua dulu, yang kedaluwarsa dilewati) untuk
 * mengurangi tagihan PO. `dry_run: true` hanya menghitung alokasi.
 */
export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.items);
  const body = await validateBody(request, applySchema);
  const outstanding = await requireOutstanding(body.purchase_order_id);
  if (body.amount > outstanding + 0.01) {
    throw ApiError.badRequest(`Jumlah melebihi sisa tagihan PO (${outstanding})`);
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
}, "purchasing.vendor-credits.apply");
