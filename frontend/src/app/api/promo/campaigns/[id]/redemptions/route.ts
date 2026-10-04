import type { NextRequest } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { listRedemptions } from "@/lib/promo/campaigns-server";
import { requirePromoContext } from "@/lib/promo/server";

type Ctx = { params: Promise<{ id: string }> };

// EPIC-032 A3 — riwayat pemakaian satu campaign (100 terbaru).
export const GET = apiHandler(async (_request: NextRequest, { params }: Ctx) => {
  const ctx = await requirePromoContext();
  const { id } = await params;
  return successResponse(await listRedemptions(ctx, id));
}, "promo.campaigns.redemptions.GET");
