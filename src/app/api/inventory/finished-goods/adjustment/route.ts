import { NextRequest } from "next/server";
import { z } from "zod";
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { adjustProductStock } from "@/lib/inventory/product-adjustment";

const adjustmentSchema = z.object({
  product_id: z.string().uuid("Produk wajib dipilih"),
  qty_actual: z.number().min(0, "Stok aktual minimal 0"),
  notes: z.string().optional(),
});

const ADJUST_ERRORS = {
  not_found: () => ApiError.notFound("Produk tidak ditemukan"),
  forbidden: () => ApiError.forbidden("Produk tidak tersedia untuk scope Anda"),
} as const;

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.itemsInventory);
  const body = await validateBody(request, adjustmentSchema);
  const result = await adjustProductStock({
    db: await createServerPgClient(),
    scope: await getApiUserScope(),
    userId: user.id,
    productId: body.product_id,
    qtyActual: body.qty_actual,
    notes: body.notes,
  });

  if ("error" in result) {
    const toError = ADJUST_ERRORS[result.error as keyof typeof ADJUST_ERRORS];
    throw toError ? toError() : ApiError.notFound("Data stok produk tidak ditemukan");
  }

  return Response.json({
    success: true,
    data: result.data,
    adjustment: result.adjustment,
    message: result.adjustment.qty_diff === 0 ? "Stok tidak berubah" : "Stok produk berhasil disesuaikan",
  });
}, "POST /api/inventory/finished-goods/adjustment");
