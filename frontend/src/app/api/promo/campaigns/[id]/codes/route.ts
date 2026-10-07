import type { NextRequest } from "next/server";
import { successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { codeCreateSchema, codeSyncSchema } from "@/lib/promo/campaign-schema";
import { createCodes, listCodes, syncVoucherCount } from "@/lib/promo/codes-server";
import { requirePromoContext } from "@/lib/promo/server";

type Ctx = { params: Promise<{ id: string }> };

// EPIC-032 A3 — kode di bawah satu campaign: list + tambah kode publik
// tunggal ATAU generate batch voucher sekali-pakai (usage_limit=1).
// Export CSV dilakukan klien dari hasil GET (tanpa route khusus).

export const GET = apiHandler(async (_request: NextRequest, { params }: Ctx) => {
  const ctx = await requirePromoContext();
  const { id } = await params;
  return successResponse(await listCodes(ctx, id));
}, "promo.campaigns.codes.GET");

export const POST = apiHandler(async (request: NextRequest, { params }: Ctx) => {
  const ctx = await requirePromoContext();
  const { id } = await params;
  const body = await validateBody(request, codeCreateSchema);
  const created = await createCodes(ctx, id, body);
  if (created.mode === "single") return successResponse(created.code, "Kode ditambahkan");
  return successResponse({ count: created.count, codes: created.codes }, `${created.count} voucher dibuat`);
}, "promo.campaigns.codes.POST");

/** Samakan jumlah voucher campaign (hanya jika belum ada yang terpakai). */
export const PATCH = apiHandler(async (request: NextRequest, { params }: Ctx) => {
  const ctx = await requirePromoContext();
  const { id } = await params;
  const body = await validateBody(request, codeSyncSchema);
  const { result, message } = await syncVoucherCount(ctx, id, body.target_count, body.prefix);
  return successResponse(result, message);
}, "promo.campaigns.codes.PATCH");
