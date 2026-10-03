import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { reloadGiftCard } from "@/lib/giftcard/giftcard-server";
import { giftCardReloadSchema } from "@/lib/giftcard/reload-schema";
import { requirePromoContext } from "@/lib/giftcard/server";

// Reload (top up) saldo gift card dari dashboard. Pembayaran (metode +
// referensi) tersimpan di baris ledger `isi` ber-context `reload`.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, ctx } = await requirePromoContext();
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = giftCardReloadSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const result = await reloadGiftCard({
      scope: { companyId: ctx.companyId, branchId: ctx.branchId },
      card: { id },
      amount: parsed.data.amount,
      paymentMethod: parsed.data.payment_method,
      paymentReference: parsed.data.payment_reference ?? null,
      note: parsed.data.note ?? null,
      createdBy: ctx.user.id,
    });
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.reason }, { status: result.status });
    }
    return successResponse(result, "Saldo gift card bertambah");
  } catch (err) {
    console.error("[giftcard] reload error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal reload gift card" },
      { status: 500 }
    );
  }
}
