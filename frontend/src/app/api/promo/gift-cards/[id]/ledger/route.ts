import type { NextRequest } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { loadGiftCardLedger } from "@/lib/promo/gift-cards-server";
import { requirePromoContext } from "@/lib/promo/server";

type Ctx = { params: Promise<{ id: string }> };

// EPIC-034 Fase A — riwayat pergerakan saldo satu kartu (isi/pakai/koreksi).
export const GET = apiHandler(async (_request: NextRequest, { params }: Ctx) => {
  const ctx = await requirePromoContext();
  const { id } = await params;
  return successResponse(await loadGiftCardLedger(ctx, id));
}, "promo.gift-cards.ledger.GET");
