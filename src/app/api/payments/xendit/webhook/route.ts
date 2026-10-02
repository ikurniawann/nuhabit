import { NextRequest, NextResponse } from "next/server";
import { createPgClient } from "@/lib/pg/create-client";
import {
  MixedCheckoutError,
  completeMixedCheckout,
  resolveXenditPaidWebhookAction,
} from "@/lib/pos/create-mixed-checkout";
import { creditPendingTopup } from "@/lib/pos/topup-credit";
import { settleOrderQrisPayment } from "@/lib/pos/settle-order-qris";
import { settlePassOrderFromWebhook } from "@/lib/studio/order-server";
import {
  extractXenditWebhookToken,
  loadActiveXenditConfig,
  parseXenditQrWebhook,
  verifyXenditWebhookToken,
} from "@/lib/payments/xendit";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

/**
 * Xendit QR paid / payment callback.
 * Configure this URL in Xendit Dashboard → Callbacks → QR code,
 * and optionally in Settings → Payment Gateways → Callback URL.
 */
export async function POST(request: NextRequest) {
  try {
    const db = createPgClient();
    let config;
    try {
      config = await loadActiveXenditConfig(db);
    } catch {
      // ACK 200 supaya dashboard Xendit tidak "failed"; proses via poll kasir.
      return NextResponse.json({
        success: true,
        ignored: true,
        reason: "xendit_not_configured",
      });
    }

    const incomingToken = extractXenditWebhookToken(request);
    if (!verifyXenditWebhookToken(incomingToken, config.webhookToken)) {
      return NextResponse.json({ success: false, error: "Invalid callback token" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const parsed = parseXenditQrWebhook(body);

    if (!parsed.paid) {
      return NextResponse.json({
        success: true,
        ignored: true,
        reason: "not_paid",
        status: parsed.status,
      });
    }

    // Pesanan paket Member App NüHabit (EPIC-057): reference_id berawalan NHP-.
    if (await settlePassOrderFromWebhook(parsed)) {
      return NextResponse.json({ success: true, handled: "studio_pass_order" });
    }

    // Resolve pending topup by QR id or merchant reference
    let txId: string | null = null;

    if (parsed.qrId) {
      const { data } = await db
        .from("pos_wallet_transactions")
        .select("id")
        .eq("xendit_transaction_id", parsed.qrId)
        .eq("type", "topup")
        .maybeSingle();
      if (data?.id) txId = String(data.id);
    }

    if (!txId && parsed.referenceId) {
      const { data } = await db
        .from("pos_wallet_transactions")
        .select("id")
        .eq("reference_id", parsed.referenceId)
        .eq("type", "topup")
        .maybeSingle();
      if (data?.id) txId = String(data.id);
    }

    // Some payloads put QR id in `id` while payment id is nested
    if (!txId && parsed.paymentId && parsed.paymentId !== parsed.qrId) {
      const { data } = await db
        .from("pos_wallet_transactions")
        .select("id")
        .eq("xendit_transaction_id", parsed.paymentId)
        .eq("type", "topup")
        .maybeSingle();
      if (data?.id) txId = String(data.id);
    }

    let checkoutId: string | null = null;
    if (!txId && parsed.referenceId) {
      try {
        const { data: checkout, error: checkoutError } = await db
          .from("pos_checkouts")
          .select("id")
          .eq("xendit_external_id", parsed.referenceId)
          .maybeSingle();
        if (checkoutError) {
          console.warn("[xendit webhook] checkout lookup skipped:", checkoutError.message);
        } else if (checkout?.id) {
          checkoutId = String(checkout.id);
        }
      } catch (error) {
        console.warn(
          "[xendit webhook] checkout lookup skipped:",
          error instanceof Error ? error.message : error
        );
      }
    }

    let childCount = 0;
    if (checkoutId) {
      const { data: children } = await db
        .from("pos_orders")
        .select("id")
        .eq("checkout_id", checkoutId);
      childCount = (children || []).length;
    }

    // Bug #2 fix (insiden 2026-08-25): QRIS diikat ke SATU order open bill
    // (bukan checkout) sejak 2026-08-23 — webhook belum pernah mengenali
    // kasus ini, jadi pembayaran yang lunas di Xendit tidak pernah
    // auto-settle di sini (hanya lewat polling client, yang gagal kalau tab
    // kasir ditutup). Dicari HANYA kalau bukan topup & bukan checkout.
    let standaloneOrderId: string | null = null;
    if (!txId && !checkoutId && parsed.referenceId) {
      try {
        const { data: order, error: orderLookupError } = await db
          .from("pos_orders")
          .select("id")
          .eq("xendit_external_id", parsed.referenceId)
          .maybeSingle();
        if (orderLookupError) {
          console.warn("[xendit webhook] order lookup skipped:", orderLookupError.message);
        } else if (order?.id) {
          standaloneOrderId = String(order.id);
        }
      } catch (error) {
        console.warn(
          "[xendit webhook] order lookup skipped:",
          error instanceof Error ? error.message : error
        );
      }
    }

    const action = resolveXenditPaidWebhookAction({
      topupId: txId,
      checkoutId,
      childCount,
      orderId: standaloneOrderId,
    });

    if (action.type === "credit_topup" && txId) {
      const result = await creditPendingTopup(db, {
        transactionId: txId,
        xenditPaymentId: parsed.paymentId || parsed.qrId,
        notes: "Top-up QRIS",
      });

      return NextResponse.json({
        success: true,
        data: {
          topup_id: txId,
          credit_status: result.status,
          balance_after: "balance_after" in result ? result.balance_after : undefined,
        },
      });
    }

    if (action.type === "noop_checkout") {
      return NextResponse.json({
        success: true,
        ignored: true,
        reason: "checkout_children_exist",
        data: { checkout_id: action.checkoutId },
      });
    }

    if (action.type === "complete_checkout") {
      const result = await completeMixedCheckout(action.checkoutId, {}, {
        paymentAlreadyConfirmed: true,
      });
      return NextResponse.json({
        success: true,
        data: {
          checkout_id: action.checkoutId,
          order_ids: result.orderIds,
        },
      });
    }

    if (action.type === "complete_order") {
      const result = await settleOrderQrisPayment(db, action.orderId);
      return NextResponse.json({
        success: true,
        data: {
          order_id: action.orderId,
          settle_status: result.status,
        },
      });
    }

    console.warn("[xendit webhook] no matching topup", {
      qrId: parsed.qrId,
      referenceId: parsed.referenceId,
      paymentId: parsed.paymentId,
    });
    return NextResponse.json({
      success: true,
      ignored: true,
      reason: "topup_not_found",
    });
  } catch (error: unknown) {
    // Xendit menandai webhook failed untuk setiap non-2xx. ACK tetap 200;
    // kasir/poll atau retry manual yang menyelesaikan bisnis.
    console.error("Xendit webhook error:", error);
    return NextResponse.json({
      success: true,
      ignored: true,
      reason: error instanceof MixedCheckoutError ? "checkout_error" : "handler_error",
      error: getErrorMessage(error),
    });
  }
}

/** Xendit sometimes probes with GET when saving callback URL */
export async function GET() {
  return NextResponse.json({ success: true, service: "xendit-webhook" });
}
