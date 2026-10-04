import type { NextRequest } from "next/server";
import { ApiError, noContentResponse, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { deleteOfferRule, getOfferRule, updateOfferRule } from "@/lib/promo/offer-rules-server";
import { offerRuleBodySchema } from "@/lib/promo/offer-schema";
import { requirePromoContext } from "@/lib/promo/server";

const updateSchema = offerRuleBodySchema.partial({ offer_type: true });

type Ctx = { params: Promise<{ id: string }> };

export const GET = apiHandler(async (_request: NextRequest, { params }: Ctx) => {
  const ctx = await requirePromoContext();
  const { id } = await params;
  const row = await getOfferRule({ id, companyId: ctx.companyId, branchId: ctx.branchId });
  if (!row) throw ApiError.notFound("Aturan tidak ditemukan");
  return successResponse(row);
}, "promo.offers.id.GET");

export const PATCH = apiHandler(async (request: NextRequest, { params }: Ctx) => {
  const ctx = await requirePromoContext();
  const { id } = await params;
  const body = await validateBody(request, updateSchema);
  const existing = await getOfferRule({ id, companyId: ctx.companyId, branchId: ctx.branchId });
  if (!existing) throw ApiError.notFound("Aturan tidak ditemukan");
  const updated = await updateOfferRule({
    id,
    companyId: ctx.companyId,
    branchId: ctx.branchId,
    payload: { ...body, offer_type: existing.offer_type },
  });
  return successResponse(updated, "Aturan promo diperbarui");
}, "promo.offers.id.PATCH");

export const DELETE = apiHandler(async (_request: NextRequest, { params }: Ctx) => {
  const ctx = await requirePromoContext();
  const { id } = await params;
  const deleted = await deleteOfferRule({ id, companyId: ctx.companyId, branchId: ctx.branchId });
  if (!deleted) throw ApiError.notFound("Aturan tidak ditemukan");
  return noContentResponse();
}, "promo.offers.id.DELETE");
