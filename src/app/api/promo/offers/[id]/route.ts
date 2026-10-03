import { NextRequest, NextResponse } from "next/server";
import { successResponse, noContentResponse } from "@/lib/api/auth";
import { requirePromoContext } from "@/lib/promo/server";
import { offerRuleBodySchema } from "@/lib/promo/offer-schema";
import {
  deleteOfferRule,
  getOfferRule,
  updateOfferRule,
  OfferRuleInputError,
} from "@/lib/promo/offer-rules-server";

const updateSchema = offerRuleBodySchema.partial({ offer_type: true });

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: Ctx) {
  const { error, ctx } = await requirePromoContext();
  if (error) return error;
  const { id } = await context.params;

  try {
    const row = await getOfferRule({
      id,
      companyId: ctx.companyId,
      branchId: ctx.branchId,
    });
    if (!row) {
      return NextResponse.json(
        { success: false, error: "Aturan tidak ditemukan" },
        { status: 404 }
      );
    }
    return successResponse(row);
  } catch (err) {
    console.error("[promo/offers/:id] GET failed:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat aturan" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, context: Ctx) {
  const { error, ctx } = await requirePromoContext();
  if (error) return error;
  const { id } = await context.params;

  try {
    const parsed = updateSchema.safeParse(await request.json());
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

    const existing = await getOfferRule({
      id,
      companyId: ctx.companyId,
      branchId: ctx.branchId,
    });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Aturan tidak ditemukan" },
        { status: 404 }
      );
    }

    const updated = await updateOfferRule({
      id,
      companyId: ctx.companyId,
      branchId: ctx.branchId,
      payload: {
        ...parsed.data,
        offer_type: existing.offer_type,
      },
    });
    return successResponse(updated, "Aturan promo diperbarui");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gagal memperbarui";
    const status = err instanceof OfferRuleInputError ? 400 : 500;
    if (status === 500) console.error("[promo/offers/:id] PATCH failed:", err);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function DELETE(_request: NextRequest, context: Ctx) {
  const { error, ctx } = await requirePromoContext();
  if (error) return error;
  const { id } = await context.params;

  try {
    const ok = await deleteOfferRule({
      id,
      companyId: ctx.companyId,
      branchId: ctx.branchId,
    });
    if (!ok) {
      return NextResponse.json(
        { success: false, error: "Aturan tidak ditemukan" },
        { status: 404 }
      );
    }
    return noContentResponse();
  } catch (err) {
    console.error("[promo/offers/:id] DELETE failed:", err);
    return NextResponse.json(
      { success: false, error: "Gagal menghapus aturan" },
      { status: 500 }
    );
  }
}
