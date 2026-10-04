import { NextRequest, NextResponse } from "next/server";
import { createPgClient } from "@/lib/pg/create-client";
import { getPosSession } from "@/lib/api/auth";
import { reconcilePendingTopup } from "@/lib/pos/topup-qris-reconcile";

/**
 * POST /api/pos/topup/[id]/reconcile — "Cek pembayaran ke Xendit" manual
 * untuk topup QRIS yang masih pending (insiden owner 2026-09-04). Bila
 * Xendit mencatat pembayaran berhasil, saldo langsung dikredit (idempoten:
 * transaksi yang sudah selesai tidak dikredit dua kali).
 */
export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }
  try {
    const { id } = await context.params;
    const outcome = await reconcilePendingTopup(createPgClient(), id);
    switch (outcome.status) {
      case "credited":
        return NextResponse.json({
          success: true,
          message: "Pembayaran ditemukan di Xendit — saldo sudah dikredit",
          data: {
            status: "completed",
            topup_id: id,
            balance_before: outcome.balance_before,
            balance_after: outcome.balance_after,
            ark_coins: outcome.ark_coins,
            ark_rate: outcome.ark_rate,
            xp_awarded: outcome.xp_awarded,
            transaction: outcome.transaction,
            qr_code_url: null,
          },
        });
      case "already_completed":
        return NextResponse.json({
          success: true,
          message: "Topup ini sudah selesai sebelumnya",
          data: { status: "completed", topup_id: id, transaction: outcome.transaction, balance_after: outcome.balance_after },
        });
      case "pending":
        return NextResponse.json({
          success: true,
          message: outcome.detail,
          data: { status: "pending", topup_id: id },
        });
      case "not_found":
        return NextResponse.json({ success: false, error: "Topup tidak ditemukan" }, { status: 404 });
      case "not_qris":
        return NextResponse.json({ success: false, error: "Hanya topup QRIS pending yang bisa dicek" }, { status: 400 });
      default:
        return NextResponse.json({ success: false, error: outcome.detail }, { status: 502 });
    }
  } catch (error) {
    console.error("[topup-reconcile] manual gagal:", error);
    return NextResponse.json({ success: false, error: "Gagal mengecek pembayaran ke Xendit" }, { status: 500 });
  }
}
