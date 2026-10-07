import type { NextRequest } from "next/server";
import { successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { codePatchSchema } from "@/lib/promo/campaign-schema";
import { deleteCode, updateCode } from "@/lib/promo/codes-server";
import { requirePromoContext } from "@/lib/promo/server";

type Ctx = { params: Promise<{ id: string }> };

// Toggle aktif selalu boleh. Rename / hapus hanya jika usage_count = 0
// (voucher belum pernah terpakai).

export const PATCH = apiHandler(async (request: NextRequest, { params }: Ctx) => {
  const ctx = await requirePromoContext();
  const { id } = await params;
  const body = await validateBody(request, codePatchSchema);
  await updateCode(ctx, id, body);
  return successResponse({ id }, "Kode diperbarui");
}, "promo.codes.id.PATCH");

export const DELETE = apiHandler(async (_request: NextRequest, { params }: Ctx) => {
  const ctx = await requirePromoContext();
  const { id } = await params;
  await deleteCode(ctx, id);
  return successResponse({ id }, "Kode dihapus");
}, "promo.codes.id.DELETE");
