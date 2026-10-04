import { NextRequest, NextResponse } from "next/server";
import { createPgClient } from "@/lib/pg/create-client";
import { getPosSession } from "@/lib/api/auth";
import { reconcilePendingTopup } from "@/lib/pos/topup-qris-reconcile";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

// GET /api/pos/topup/[id]/status — poll pending QRIS topup
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }

  try {
    const { id } = await context.params;
    const db = createPgClient();

    const { data: tx, error } = await db
      .from("pos_wallet_transactions")
      .select("*")
      .eq("id", id)
      .eq("type", "topup")
      .maybeSingle();

    if (error) throw error;
    if (!tx) {
      return NextResponse.json({ success: false, error: "Topup not found" }, { status: 404 });
    }

    const status = String((tx as { status?: string }).status || "completed");
    const metadata = ((tx as { metadata?: Record<string, unknown> }).metadata ||
      {}) as Record<string, unknown>;

    if (status === "pending") {
      // Webhook Xendit bisa tidak sampai (insiden 2026-09-04): setiap poll
      // memastikan langsung ke daftar pembayaran QR di Xendit dan mengkredit
      // bila sudah dibayar. Error dicatat, tidak lagi ditelan diam-diam.
      try {
        const outcome = await reconcilePendingTopup(db, id);
        if (outcome.status === "credited") {
          return NextResponse.json({
            success: true,
            data: {
              status: "completed",
              topup_id: id,
              balance_before: outcome.balance_before,
              balance_after: outcome.balance_after,
              ark_coins: outcome.ark_coins,
              ark_rate: outcome.ark_rate,
              xp_awarded: outcome.xp_awarded,
              transaction: outcome.transaction,
              qr_code_url: metadata.qr_string
                ? `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(String(metadata.qr_string))}`
                : null,
            },
          });
        }
        if (outcome.status === "error") {
          console.warn(`[topup-status] rekonsiliasi ${id} gagal: ${outcome.detail}`);
        }
      } catch (err) {
        console.warn(`[topup-status] rekonsiliasi ${id} error:`, err instanceof Error ? err.message : err);
      }
    }

    const qrString = metadata.qr_string ? String(metadata.qr_string) : null;

    return NextResponse.json({
      success: true,
      data: {
        status,
        topup_id: id,
        balance_before: Number(tx.balance_before) || 0,
        balance_after: Number(tx.balance_after) || 0,
        ark_coins: Number(tx.ark_coins) || 0,
        transaction: tx,
        qr_code_url: qrString
          ? `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(qrString)}`
          : null,
        qr_string: qrString,
        expires_at: metadata.expires_at ? String(metadata.expires_at) : null,
      },
    });
  } catch (error: unknown) {
    console.error("Error fetching topup status:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
