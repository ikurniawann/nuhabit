import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { requirePromoContext } from "@/lib/giftcard/server";

// EPIC-034 Fase A — riwayat pergerakan saldo satu kartu (isi/pakai/koreksi).

interface LedgerRow {
  id: string;
  direction: string;
  amount: string;
  balance_after: string;
  context_type: string | null;
  context_id: string | null;
  note: string | null;
  payment_method: string | null;
  payment_reference: string | null;
  created_at: string;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, ctx } = await requirePromoContext();
  if (error) return error;

  try {
    const { id } = await params;
    const card = await queryOne<{ id: string }>(
      `SELECT id FROM giftcard.gift_cards
       WHERE id = $1 AND branch_id = $2 AND company_id = $3`,
      [id, ctx.branchId, ctx.companyId]
    );
    if (!card) {
      return NextResponse.json(
        { success: false, error: "Gift card tidak ditemukan" },
        { status: 404 }
      );
    }
    const rows = await query<LedgerRow>(
      `SELECT id, direction, amount, balance_after, context_type,
              context_id, note, payment_method, payment_reference, created_at
       FROM giftcard.gift_card_ledger
       WHERE card_id = $1
       ORDER BY created_at DESC
       LIMIT 500`,
      [id]
    );
    return successResponse(rows);
  } catch (err) {
    console.error("[giftcard] ledger error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat riwayat" },
      { status: 500 }
    );
  }
}
