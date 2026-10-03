import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { queryOne } from "@/lib/db";
import { requirePromoContext } from "@/lib/giftcard/server";
import { linkGiftCardToMember } from "@/lib/giftcard/giftcard-server";

// EPIC-034 Fase A — nonaktifkan/aktifkan kembali satu gift card, atau
// tautkan ke member. Toggle status hanya
// bolak-balik antara `active` <-> `disabled`; kartu `pending`/`exhausted`/
// `expired` tidak bisa disentuh lewat toggle ini (siklus hidupnya beda).

// Satu aksi per permintaan: toggle aktif ATAU tautkan/lepas member
// (customer_id null = lepas).
const patchSchema = z.union([
  z.object({ is_active: z.boolean() }).strict(),
  z.object({ customer_id: z.string().uuid().nullable() }).strict(),
]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, ctx } = await requirePromoContext();
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }

    if ("customer_id" in parsed.data) {
      const linked = await linkGiftCardToMember({
        scope: { companyId: ctx.companyId, branchId: ctx.branchId },
        cardId: id,
        customerId: parsed.data.customer_id,
      });
      if (!linked) {
        return NextResponse.json(
          { success: false, error: "Gift card atau member tidak ditemukan" },
          { status: 404 }
        );
      }
      return successResponse(
        { id, customer_id: parsed.data.customer_id },
        parsed.data.customer_id ? "Gift card ditautkan ke member" : "Tautan member dilepas"
      );
    }

    const current = await queryOne<{ status: string }>(
      `SELECT status FROM giftcard.gift_cards
       WHERE id = $1 AND branch_id = $2 AND company_id = $3`,
      [id, ctx.branchId, ctx.companyId]
    );
    if (!current) {
      return NextResponse.json(
        { success: false, error: "Gift card tidak ditemukan" },
        { status: 404 }
      );
    }
    if (current.status !== "active" && current.status !== "disabled") {
      return NextResponse.json(
        {
          success: false,
          error: `Gift card berstatus '${current.status}' tidak bisa diubah lewat aksi ini`,
        },
        { status: 409 }
      );
    }

    const nextStatus = parsed.data.is_active ? "active" : "disabled";
    const updated = await queryOne<{ id: string; status: string }>(
      `UPDATE giftcard.gift_cards
       SET status = $1, updated_at = now()
       WHERE id = $2 AND branch_id = $3 AND company_id = $4
       RETURNING id, status`,
      [nextStatus, id, ctx.branchId, ctx.companyId]
    );
    return successResponse(updated, "Gift card diperbarui");
  } catch (err) {
    console.error("[giftcard] update error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memperbarui gift card" },
      { status: 500 }
    );
  }
}
