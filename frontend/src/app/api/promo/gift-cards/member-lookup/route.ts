import type { NextRequest } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { findMembersByPhone } from "@/lib/giftcard/giftcard-server";
import { requirePromoContext } from "@/lib/promo/server";

// Cari member per nomor HP utk menautkan gift card (min 6 digit).
export const GET = apiHandler(async (request: NextRequest) => {
  await requirePromoContext();
  return successResponse(await findMembersByPhone(request.nextUrl.searchParams.get("phone") ?? ""));
}, "promo.gift-cards.member-lookup.GET");
