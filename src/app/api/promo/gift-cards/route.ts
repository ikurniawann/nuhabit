import type { NextRequest } from "next/server";
import { successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { giftCardIssueSchema, issueGiftCards, listGiftCards } from "@/lib/promo/gift-cards-server";
import { requirePromoContext } from "@/lib/promo/server";

// EPIC-034 Fase A — terbit gift card (admin, langsung `active`). Kode SELALU
// auto-generate CSPRNG (bearer murni, tanpa PIN), admin tidak mengetik kode.

export const GET = apiHandler(async (request: NextRequest) => {
  const ctx = await requirePromoContext();
  const sp = request.nextUrl.searchParams;
  const rows = await listGiftCards(ctx, {
    status: sp.get("status"),
    q: sp.get("q"),
    customerId: sp.get("customer_id"),
    phone: sp.get("phone") ?? "",
  });
  return successResponse(rows);
}, "promo.gift-cards.GET");

export const POST = apiHandler(async (request: NextRequest) => {
  const ctx = await requirePromoContext();
  const body = await validateBody(request, giftCardIssueSchema);
  const created = await issueGiftCards(ctx, body);
  if (body.mode === "single") return successResponse(created[0], "Gift card diterbitkan");
  return successResponse(
    { count: created.length, codes: created.map((c) => c.code) },
    `${created.length} gift card diterbitkan`
  );
}, "promo.gift-cards.POST");
