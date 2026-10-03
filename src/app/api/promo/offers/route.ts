import { NextRequest, NextResponse } from "next/server";
import { successResponse, createdResponse } from "@/lib/api/auth";
import { requirePromoContext } from "@/lib/promo/server";
import { offerRuleBodySchema } from "@/lib/promo/offer-schema";
import {
  createOfferRule,
  listOfferRules,
  OfferRuleInputError,
} from "@/lib/promo/offer-rules-server";
import type { OfferType } from "@/lib/promo/offer-rules";

export async function GET(request: NextRequest) {
  const { error, ctx } = await requirePromoContext();
  if (error) return error;

  const type = request.nextUrl.searchParams.get("type") as OfferType | null;
  if (!type || !["bundle", "bxgy", "volume"].includes(type)) {
    return NextResponse.json(
      { success: false, error: "Query type=bundle|bxgy|volume wajib" },
      { status: 400 }
    );
  }

  try {
    const rows = await listOfferRules({
      companyId: ctx.companyId,
      branchId: ctx.branchId,
      offerType: type,
    });
    return successResponse(rows);
  } catch (err) {
    console.error("[promo/offers] GET failed:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat aturan promo" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const { error, ctx } = await requirePromoContext();
  if (error) return error;

  try {
    const parsed = offerRuleBodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Validation failed",
          details: parsed.error.issues,
        },
        { status: 400 }
      );
    }

    const created = await createOfferRule({
      companyId: ctx.companyId,
      branchId: ctx.branchId,
      userId: ctx.user.id,
      payload: parsed.data,
    });
    return createdResponse(created, "Aturan promo dibuat");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gagal membuat aturan";
    const status = err instanceof OfferRuleInputError ? 400 : 500;
    if (status === 500) console.error("[promo/offers] POST failed:", err);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
