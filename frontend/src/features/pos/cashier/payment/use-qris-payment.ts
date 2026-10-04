"use client";

import { useEffect, useEffectEvent, useRef, type Dispatch } from "react";

import {
  buildPosQrisCreateBody,
  mayConfirmMixedQris,
  mixedQrisCheckoutIdForAmount,
  shouldPrepareOrderForQris,
} from "@/lib/pos/central-cashier";
import { cancelCheckout } from "@/lib/pos-api";

import {
  buildQrisConfirmPayload,
  qrisNeedsPrepare,
  type PaymentAction,
  type PaymentConfirmPayload,
  type PaymentState,
  type PreparedCheckout,
  type PreparedOrder,
  type QrisCode,
} from "./payment-state";

const QRIS_POLL_MS = 2500;

export interface QrisCallbacks {
  onConfirm: (payload: PaymentConfirmPayload) => void | Promise<void>;
  /** Cart multi-stall: siapkan checkout 'unpaid' supaya QR terikat ke checkout_id. */
  onPrepareMixedQrisCheckout?: () => Promise<Omit<PreparedCheckout, "amount">>;
  /**
   * Bug #5 fix (insiden 2026-08-25): jual instan via QRIS (bukan open bill,
   * bukan checkout multi-stall) — dipanggil SEBELUM QR dibuat supaya order
   * tersimpan 'unpaid' duluan, sehingga kalau settle gagal setelah customer
   * bayar, order tetap ada & bisa diselesaikan manual.
   */
  onPrepareOrderQris?: () => Promise<PreparedOrder>;
  /** Batalkan order yang disiapkan onPrepareOrderQris kalau kasir keluar tanpa bayar. */
  onAbandonOrderQris?: (orderId: string) => Promise<void>;
}

interface UseQrisPaymentInput extends QrisCallbacks {
  state: PaymentState;
  dispatch: Dispatch<PaymentAction>;
  /** Modal terbuka dan metode efektif = QRIS. */
  active: boolean;
  submitting: boolean;
  totalAfterArk: number;
  isMixedCart: boolean;
  payingOrderId: string | null;
}

/**
 * Sinkron QRIS dinamis dengan server: buat QR, poll status Xendit, settle
 * otomatis, dan batalkan checkout/order 'unpaid' yang ditinggal kasir.
 */
export function useQrisPayment(input: UseQrisPaymentInput) {
  const {
    state,
    dispatch,
    active,
    submitting,
    totalAfterArk,
    isMixedCart,
    payingOrderId,
    onConfirm,
    onPrepareMixedQrisCheckout,
    onPrepareOrderQris,
    onAbandonOrderQris,
  } = input;
  const preparing = qrisNeedsPrepare(state, { active, totalAfterArk, isMixedCart });

  // Bug #3 fix (insiden 2026-08-25): satu tempat memicu settle QRIS, dipakai
  // poll otomatis dan tombol "Coba lagi". Reducer berhenti auto-retry setelah
  // QRIS_MAX_AUTO_CONFIRM_ATTEMPTS gagal; sisanya kasir yang putuskan.
  const settle = (qr: QrisCode) => {
    dispatch({ type: "qris-settle-started", qrId: qr.qr_id });
    const payload = buildQrisConfirmPayload({
      qr,
      preparedCheckout: state.preparedCheckout,
      preparedOrder: state.preparedOrder,
      payingOrderId,
    });
    void Promise.resolve(onConfirm(payload))
      .then(() => dispatch({ type: "qris-settled", qrId: qr.qr_id }))
      .catch((err: unknown) =>
        dispatch({
          type: "qris-settle-failed",
          qrId: qr.qr_id,
          message: err instanceof Error ? err.message : "Gagal menyelesaikan pembayaran QRIS",
        })
      );
  };

  const retrySettle = () => {
    if (state.qris.status === "settle_error") settle(state.qris.qr);
  };

  // Buat QR dinamis saat QRIS dipilih. Gagal → jangan settle; kasir pilih
  // metode lain. Confirm QRIS hanya lewat poll Xendit (bukan klik manual).
  const prepareQris = useEffectEvent(async (isCancelled: () => boolean) => {
    const amount = totalAfterArk;
    try {
      let checkoutId = mixedQrisCheckoutIdForAmount({
        checkoutId: state.preparedCheckout?.checkout_id,
        boundAmount: state.preparedCheckout?.amount,
        currentAmount: amount,
      });
      if (isMixedCart) {
        if (!onPrepareMixedQrisCheckout) {
          throw new Error("Checkout multi-stall membutuhkan persiapan QRIS");
        }
        if (!checkoutId) {
          const prepared = await onPrepareMixedQrisCheckout();
          if (isCancelled()) return;
          checkoutId = prepared.checkout_id;
          dispatch({ type: "checkout-prepared", checkout: { ...prepared, amount } });
        }
      }

      // Bug #5 fix (insiden 2026-08-25): jual instan single-stall — bikin
      // order 'unpaid' DULU supaya QR selalu terikat ke order tersimpan,
      // sama seperti checkout multi-stall di atas. Kalau bayar gagal
      // ter-settle, order tetap ada di Orders (bukan orphan tanpa jejak).
      let orderId = payingOrderId || state.preparedOrder?.order_id || null;
      if (
        shouldPrepareOrderForQris({
          method: "qris",
          isMixedCart,
          payingOrderId,
          hasPreparedOrder: Boolean(state.preparedOrder),
        })
      ) {
        if (!onPrepareOrderQris) {
          throw new Error("Penjualan QRIS membutuhkan persiapan order");
        }
        const prepared = await onPrepareOrderQris();
        if (isCancelled()) {
          void onAbandonOrderQris?.(prepared.order_id).catch(() => {});
          return;
        }
        dispatch({ type: "order-prepared", order: prepared });
        orderId = prepared.order_id;
      }

      const res = await fetch("/api/pos/qris", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPosQrisCreateBody({ amount, checkoutId, orderId })),
      });
      const body = await res.json();
      if (isCancelled()) return;
      if (!res.ok) {
        dispatch({
          type: "qris-unavailable",
          error:
            typeof body.error === "string" && body.error.trim()
              ? body.error
              : "Gagal membuat QR pembayaran",
        });
        return;
      }
      dispatch({
        type: "qris-ready",
        qr: {
          amount: body.data.amount,
          qr_string: body.data.qr_string,
          qr_id: String(body.data.qr_id || ""),
          reference_id: String(body.data.reference_id || ""),
          merchant_name: body.data.merchant_name ?? null,
          nmid: body.data.nmid ?? null,
        },
      });
    } catch (err) {
      if (isCancelled()) return;
      dispatch({
        type: "qris-unavailable",
        error: err instanceof Error ? err.message : "Gagal menghubungi server QR",
      });
    }
  });

  useEffect(() => {
    if (!preparing) return;
    let cancelled = false;
    void prepareQris(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [preparing, totalAfterArk, isMixedCart, payingOrderId]);

  // QRIS lunas di Xendit → checkout otomatis, sama seperti tunai.
  const pollQrId =
    active && !submitting && state.qris.status === "ready" ? state.qris.qr.qr_id : "";
  const onXenditPaid = useEffectEvent((): boolean => {
    const { qris, preparedCheckout } = state;
    if (qris.status !== "ready") return false;
    if (
      !mayConfirmMixedQris({
        isMixedCart,
        method: "qris",
        qrisPaid: true,
        checkoutId: preparedCheckout?.checkout_id,
      })
    ) {
      return false;
    }
    settle(qris.qr);
    return true;
  });

  useEffect(() => {
    if (!pollQrId) return;
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/pos/qris/${encodeURIComponent(pollQrId)}/status`);
        const body = await res.json().catch(() => ({}));
        if (stopped) return;
        if (res.ok && body?.data?.paid && onXenditPaid()) stopped = true;
      } catch {
        // Poll lanjut; kasir tetap bisa batal
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), QRIS_POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [pollQrId]);

  // Checkout/order 'unpaid' yang ditinggal (tutup modal, ganti metode, total
  // berubah) dibatalkan; reducer sudah melewatkan yang sudah dibayar.
  const handledAbandon = useRef(new Set<string>());
  const abandonOrder = useEffectEvent((orderId: string) => {
    void onAbandonOrderQris?.(orderId).catch(() => {});
  });
  useEffect(() => {
    for (const task of state.abandon) {
      const key = `${task.kind}:${task.id}`;
      if (handledAbandon.current.has(key)) continue;
      handledAbandon.current.add(key);
      if (task.kind === "checkout") void cancelCheckout(task.id).catch(() => {});
      else abandonOrder(task.id);
    }
  }, [state.abandon]);

  return { preparing, retrySettle };
}
