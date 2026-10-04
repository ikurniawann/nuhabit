import type { NextRequest } from "next/server";
import { ApiError, createdResponse, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { OFFER_TYPES, type OfferType } from "@/lib/promo/offer-rules";
import { createOfferRule, listOfferRules } from "@/lib/promo/offer-rules-server";
import { offerRuleBodySchema } from "@/lib/promo/offer-schema";
import { requirePromoContext } from "@/lib/promo/server";

const isOfferType = (value: string | null): value is OfferType =>
  (OFFER_TYPES as readonly string[]).includes(value ?? "");

export const GET = apiHandler(async (request: NextRequest) => {
  const ctx = await requirePromoContext();
  const type = request.nextUrl.searchParams.get("type");
  if (!isOfferType(type)) throw ApiError.badRequest("Query type=bundle|bxgy|volume wajib");
  return successResponse(
    await listOfferRules({ companyId: ctx.companyId, branchId: ctx.branchId, offerType: type })
  );
}, "promo.offers.GET");

export const POST = apiHandler(async (request: NextRequest) => {
  const ctx = await requirePromoContext();
  const payload = await validateBody(request, offerRuleBodySchema);
  const created = await createOfferRule({
    companyId: ctx.companyId,
    branchId: ctx.branchId,
    userId: ctx.user.id,
    payload,
  });
  return createdResponse(created, "Aturan promo dibuat");
}, "promo.offers.POST");
