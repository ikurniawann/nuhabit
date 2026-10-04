"use client";

/**
 * Pembayaran kasir untuk semua metode (tunai, kartu, QRIS, ARK, gift card,
 * NFC Tab, FOC, offline) plus persiapan checkout QRIS multi-stall. Handler
 * tidak pernah melempar error: PaymentModal menganggap promise yang resolve
 * = selesai, kegagalan tampil sebagai toast.
 */

import { useEffect, useRef, type Dispatch } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { usePosCart } from "@/hooks/use-pos-cart";
import { usePosCheckout } from "@/hooks/use-pos-checkout";
import { completeCheckout, type CustomerWithDiscount } from "@/lib/pos-api";
import type { ReceiptPayload } from "@/components/pos/PrintReceipt";
import { buildCheckoutBillPayBody } from "@/lib/pos/central-cashier";
import { idleCfdState, publishCfdState } from "@/lib/pos/cfd";
import { isFocPaymentMethod } from "@/lib/pos/payment-methods";
import { offlineReceiptNumber } from "@/lib/pos/offline-sync";
import { formatPaymentMethodLabel } from "@/lib/pos/reports/transaction-labels";
import type { CashierCheckout } from "./api";
import type { PaymentConfirmPayload } from "./payment";
import { usePayOpenOrder } from "./mutations";
import {
  cashChange,
  focReceiptFields,
  offlineOrderItems,
  offlinePaymentMethod,
  paymentBlocker,
  receiptDiscountLines,
  type CashierBill,
} from "./checkout";
import type {
  CashierSessionAction,
  CashierSessionState,
  ResultKind,
} from "./cashier-session";
import { CASHIER_ID } from "./constants";
import { writeLastOpenCheckoutId } from "./last-open-checkout";

const LAST_RECEIPT_KEY = "pos:lastReceipt";
/** Base UI Dialog tidak bisa tutup+buka di tick yang sama: struk muncul setelah modal bayar unmount. */
const RECEIPT_REVEAL_DELAY_MS = 120;

export interface CashierCheckoutDeps {
  cart: ReturnType<typeof usePosCart>;
  session: CashierSessionState;
  dispatch: Dispatch<CashierSessionAction>;
  bill: CashierBill;
  customer: CustomerWithDiscount | null;
  /** Nama pemesan self-order (bukan member) supaya struk tidak "Walk-in". */
  contactName?: string;
  table: { id: string | null; label: string | null };
  guestCount: number;
  shiftId: string | null;
  stallName: string | null;
  isOnline: boolean;
  xpEnabled: boolean;
  paymentOrderId: string | null;
  paymentCheckoutId: string | null;
  paymentCheckout: CashierCheckout | undefined;
  /** Keranjang berisi item dari 2+ stall (checkout kasir-pusat). */
  mixedCart: boolean;
  fromRestaurant: boolean;
  homeRoute: string;
  requireActiveShift: () => boolean;
  refetchCustomers: () => void;
  openNfc: () => void;
  enqueueOffline: (payload: Record<string, unknown>, kind: "order") => Promise<unknown>;
  refreshOfflineCount: () => Promise<unknown>;
}

export function useCheckoutActions(deps: CashierCheckoutDeps) {
  const router = useRouter();
  const { checkout, submitting } = usePosCheckout();
  const payOpenOrder = usePayOpenOrder();
  const revealTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (revealTimer.current) window.clearTimeout(revealTimer.current);
    },
    []
  );


  const { cart, session, dispatch, bill, customer, table } = deps;
  const { stack, billCharges, total, offerEval } = bill;
  const offerDiscount = stack.offer_amount;
  const offerLabels = offerEval.applied.map((offer) => offer.name);
  const promo = session.promo.applied;
  const receiptExtras = {
    subtotal: stack.gross_subtotal,
    discountLines: receiptDiscountLines(bill.discount),
    stallName: deps.stallName,
  };

  const receiptBase = (paymentMethod: string) => ({
    orderType: cart.orderType,
    table: table.label,
    items: [...cart.items],
    notes: cart.notes,
    paymentMethod,
    customerName: customer?.name ?? deps.contactName,
    discountAmount: stack.discount_amount,
    taxAmount: billCharges.tax_amount,
  });

  /** Satu titik sukses bayar: simpan struk, layar customer "selesai", kosongkan keranjang. */
  const finishPayment = (
    receipt: ReceiptPayload,
    options: { kind?: ResultKind; clearBill?: boolean; navigateHome?: boolean } = {}
  ) => {
    window.sessionStorage.setItem(LAST_RECEIPT_KEY, JSON.stringify(receipt));
    writeLastOpenCheckoutId(null);
    // EPIC-024: layar customer merayakan transaksi selesai + kembalian.
    publishCfdState({
      ...idleCfdState(),
      status: "done",
      total: receipt.total,
      done_change: receipt.change > 0 ? receipt.change : 0,
      updated_at: Date.now(),
    });
    // Nomor WA diambil saat bayar, sebelum member dilepas dari keranjang.
    const waPhone = String(customer?.phone || session.giftCardBuyer?.phone || "").trim();
    if (revealTimer.current) window.clearTimeout(revealTimer.current);
    revealTimer.current = window.setTimeout(() => {
      dispatch({ type: "resultRevealed", payload: receipt, kind: options.kind ?? "standard", waPhone });
      revealTimer.current = null;
    }, RECEIPT_REVEAL_DELAY_MS);
    dispatch({
      type: "paymentSucceeded",
      clearBill: Boolean(options.clearBill),
      returnToRestaurant: deps.fromRestaurant,
    });
    cart.clearCart();
    if (options.navigateHome && !deps.fromRestaurant) router.replace(deps.homeRoute);
  };

  const checkoutRequest = (method: string) => ({
    cart: cart.items,
    orderType: cart.orderType,
    selectedTable: table.id,
    selectedCustomer: customer,
    paymentMethod: method,
    includeTax: cart.includeTax,
    notes: cart.notes,
    shiftId: deps.shiftId,
    promo,
    billCharges,
    manualDiscountType: cart.manual_discount_type,
    manualDiscountValue: cart.manual_discount_value,
    offerDiscount,
    offerLabels,
  });

  /** Gift card / NFC Tab: debit server-authoritative, uang tidak masuk laci. */
  const payWithStoredValue = async (
    method: "gift_card" | "nfc_tab",
    credential: string,
    receiptMethod: string,
    catalog: { payment_method_code?: string; payment_method_name?: string }
  ) => {
    const failure = method === "gift_card" ? "Pembayaran gift card gagal" : "Charge ke tab gagal";
    let orderId: string;
    let orderNumber: string;
    let queueNumber: string | null;
    if (deps.paymentOrderId) {
      const data = await payOpenOrder.mutateAsync({
        orderId: deps.paymentOrderId,
        payload: {
          payment_status: "paid",
          payment_method: method,
          amount_paid: 0,
          ark_coins_used: 0,
          ...(method === "gift_card" ? { gift_card_code: credential } : { nfc_tab_uid: credential }),
          ...catalog,
        },
      });
      orderId = deps.paymentOrderId;
      orderNumber = session.bill.number || data.data?.order_number || deps.paymentOrderId;
      queueNumber = data.data?.queue_number || null;
    } else {
      const res = await checkout({
        ...checkoutRequest(method),
        cashReceived: "",
        arkToUse: 0,
        ...(method === "gift_card" ? { giftCardCode: credential } : { nfcTabUid: credential }),
        paymentMethodCode: catalog.payment_method_code,
        paymentMethodName: catalog.payment_method_name,
      });
      if (!res.success) {
        toast.error(res.error || failure);
        return;
      }
      orderId = res.orderId || "";
      orderNumber = res.orderNumber || "";
      queueNumber = res.queueNumber || null;
    }
    finishPayment(
      {
        ...receiptBase(receiptMethod),
        orderId,
        orderNumber,
        queueNumber,
        total,
        change: 0,
        chargesBreakdown: billCharges.breakdown,
        ...receiptExtras,
      },
      { clearBill: true, navigateHome: Boolean(deps.paymentOrderId) }
    );
  };

  const confirmPayment = async (p: PaymentConfirmPayload) => {
    // Tender terakhir dipakai pratinjau ARK di keranjang; hitungan di bawah
    // tetap memakai tender render ini (sama seperti sebelum refactor).
    dispatch({ type: "tenderChosen", method: p.method, arkToUse: p.arkToUse });
    if (session.processing) return;
    // Bug #5 fix (insiden 2026-08-25): settle order QRIS yang sudah disiapkan
    // tidak boleh dijegal guard keranjang kosong.
    if (cart.items.length === 0 && !p.orderId && !deps.paymentOrderId) return;
    if (!deps.requireActiveShift()) return;

    const method: string = p.method;
    const catalog = {
      payment_method_code: p.paymentMethodCode,
      payment_method_name: p.paymentMethodName,
    };
    const foc = isFocPaymentMethod(p.paymentMethodCode, p.paymentMethodName);
    const focPin = p.supervisorPin?.trim() || "";
    const { mixedCart } = deps;
    const blocker = paymentBlocker({
      method,
      foc,
      hasCustomer: Boolean(customer),
      supervisorPin: focPin,
      isOnline: deps.isOnline,
      mixedCart,
      hasPromo: Boolean(promo),
      itemDiscountTotal: stack.line_discount_total,
      payingCheckoutBill: Boolean(deps.paymentCheckoutId),
      preparedCheckoutId: p.checkoutId,
    });
    if (blocker) {
      toast.error(blocker);
      return;
    }
    const focFields = foc ? { supervisor_pin: focPin } : {};
    const receiptMethod = formatPaymentMethodLabel(method, {
      code: p.paymentMethodCode,
      name: p.paymentMethodName,
    });
    const arkCapped = Math.min(p.arkToUse, bill.maxArkUsable);
    const payTotal = total - (method === "ark_coin" ? arkCapped : bill.arkToUseCapped);

    const run = async (failure: string, task: () => Promise<void>) => {
      dispatch({ type: "processingChanged", processing: true });
      try {
        await task();
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : failure);
      } finally {
        dispatch({ type: "processingChanged", processing: false });
      }
    };

    // Checkout multi-stall via QRIS: checkout disiapkan PaymentModal, lunas di Xendit.
    if (mixedCart && method === "qris") {
      const checkoutId = p.checkoutId;
      if (!checkoutId) {
        toast.error("Menunggu pembayaran QRIS");
        return;
      }
      await run("Pembayaran QRIS gagal", async () => {
        await completeCheckout(checkoutId, { payment_method: "qris", amount_paid: total, ...catalog });
        finishPayment({
          ...receiptBase(receiptMethod),
          orderId: checkoutId,
          orderNumber: p.checkoutNumber,
          checkoutNumber: p.checkoutNumber,
          queueNumber: p.queueNumber ?? null,
          total,
          change: 0,
          chargesBreakdown: billCharges.breakdown,
        });
        toast.success(
          p.queueNumber ? `Pembayaran berhasil — Antrian ${p.queueNumber}` : "Pembayaran berhasil"
        );
      });
      return;
    }

    // EPIC-034 Fase C (gift card) dan EPIC-023 Fase C (NFC Tab): butuh koneksi.
    if (method === "gift_card" || method === "nfc_tab") {
      const credential =
        method === "gift_card"
          ? p.giftCardCode?.trim().toUpperCase() || ""
          : p.nfcTabUid?.trim() || "";
      if (!credential) {
        toast.error(method === "gift_card" ? "Masukkan kode gift card dulu" : "Tap gelang pengunjung dulu");
        return;
      }
      if (!deps.isOnline) {
        toast.error(
          method === "gift_card"
            ? "Pembayaran gift card membutuhkan koneksi — gunakan metode lain saat offline"
            : "Pembayaran NFC Tab membutuhkan koneksi — gunakan metode lain saat offline"
        );
        return;
      }
      await run(
        method === "gift_card" ? "Pembayaran gift card gagal" : "Charge ke tab gagal",
        () => payWithStoredValue(method, credential, receiptMethod, catalog)
      );
      return;
    }

    if (method === "ark_coin" && !customer) {
      deps.openNfc();
      return;
    }
    // FOC: tidak ada uang diterima, lewati validasi nominal tunai.
    if (method === "cash" && !foc && (parseFloat(p.cashReceived) || 0) < payTotal) {
      toast.error("Nominal tunai kurang dari total tagihan");
      return;
    }

    // Tagihan checkout kasir-pusat (open bill multi-stall).
    const payingCheckoutId = deps.paymentCheckoutId;
    if (payingCheckoutId) {
      if (promo) {
        toast.error("Kode promo belum didukung untuk pembayaran open bill — hapus kode dulu");
        return;
      }
      await run("Payment failed", async () => {
        const completeRes = await completeCheckout(payingCheckoutId, {
          ...buildCheckoutBillPayBody({
            method,
            cashReceived: p.cashReceived,
            total: payTotal,
            paymentMethodCode: p.paymentMethodCode,
            paymentMethodName: p.paymentMethodName,
          }),
          ...focFields,
        });
        const approvedName = (completeRes.data as { comp_approved_name?: string | null } | undefined)
          ?.comp_approved_name;
        finishPayment(
          {
            ...receiptBase(receiptMethod),
            orderId: payingCheckoutId,
            orderNumber: session.bill.number || payingCheckoutId,
            checkoutNumber: deps.paymentCheckout?.checkout_number || session.bill.number || undefined,
            queueNumber: null,
            total: payTotal,
            change: cashChange(method, p.cashReceived, payTotal),
            ...(foc ? focReceiptFields(payTotal, approvedName) : {}),
          },
          { clearBill: true, navigateHome: true }
        );
        if (customer) deps.refetchCustomers();
      });
      return;
    }

    // Open bill tersimpan, atau order QRIS jual instan yang sudah disiapkan.
    const targetOrderId = deps.paymentOrderId || p.orderId || null;
    if (targetOrderId) {
      if (promo) {
        toast.error("Kode promo belum didukung untuk pembayaran open bill — hapus kode dulu");
        return;
      }
      await run("Payment failed", async () => {
        const data = await payOpenOrder.mutateAsync({
          orderId: targetOrderId,
          payload: {
            payment_status: "paid",
            payment_method: method === "credit_card" ? "credit" : method,
            amount_paid: method === "cash" ? parseFloat(p.cashReceived) || payTotal : payTotal,
            ark_coins_used: method === "ark_coin" ? arkCapped : 0,
            xendit_qr_id: p.xenditQrId,
            xendit_external_id: p.xenditExternalId,
            ...catalog,
            ...focFields,
          },
        });
        finishPayment(
          {
            ...receiptBase(receiptMethod),
            orderId: targetOrderId,
            orderNumber:
              session.bill.number || p.orderNumber || data.data?.order_number || targetOrderId,
            queueNumber: data.data?.queue_number || null,
            total: payTotal,
            change: cashChange(method, p.cashReceived, payTotal),
            // EPIC-041: snapshot ARK/XP dari respons pembayaran utk struk.
            arkPaid: method === "ark_coin" ? arkCapped : 0,
            arkBalanceAfter: data.ark_balance_after ?? null,
            // XP nonaktif (CRM → Pengaturan): blok XP tidak dicetak di struk.
            xpEarned: deps.xpEnabled ? data.crm_xp?.xpAwarded : undefined,
            xpTotalAfter: deps.xpEnabled ? (data.xp_total_after ?? null) : null,
            ...receiptExtras,
            ...(foc
              ? focReceiptFields(
                  payTotal,
                  (data.data as { comp_approved_name?: string | null } | undefined)
                    ?.comp_approved_name
                )
              : {}),
          },
          { clearBill: true, navigateHome: true }
        );
        // Saldo ARK/XP customer berubah di server: segarkan cache kasir.
        if (customer) deps.refetchCustomers();
      });
      return;
    }

    if (!deps.isOnline) {
      if (promo) {
        toast.error("Kode promo membutuhkan koneksi — hapus kode atau tunggu online");
        return;
      }
      await run("Payment failed", async () => {
        await deps.enqueueOffline(
          {
            order_type: cart.orderType,
            customer_id: customer?.id,
            cashier_id: CASHIER_ID,
            table_id: table.id || undefined,
            guest_count: deps.guestCount,
            items: offlineOrderItems(cart.items),
            subtotal: stack.gross_subtotal,
            discount_amount: stack.discount_amount,
            tax_amount: billCharges.tax_amount,
            service_charge_amount: billCharges.service_charge_amount,
            other_charges_amount: billCharges.other_charges_amount,
            charges_breakdown: billCharges.breakdown,
            total_amount: total,
            payment_method: offlinePaymentMethod(method),
            amount_paid: method === "cash" ? parseFloat(p.cashReceived) || total : total,
            ...catalog,
            include_tax: cart.includeTax,
            membership_discount_pct: bill.discount.membershipPct,
            notes: cart.notes,
            ark_coins_used: method === "ark_coin" ? arkCapped : 0,
            shift_id: deps.shiftId || undefined,
          },
          "order"
        );
        const offlineNumber = offlineReceiptNumber(Date.now());
        finishPayment(
          {
            ...receiptBase(receiptMethod),
            orderId: offlineNumber,
            orderNumber: offlineNumber,
            total,
            change: cashChange(method, p.cashReceived, total),
            chargesBreakdown: billCharges.breakdown,
            // Offline: saldo/XP belum diketahui, hanya nominal ARK yang dipakai.
            arkPaid: method === "ark_coin" ? arkCapped : 0,
            ...receiptExtras,
          },
          { kind: "offlined" }
        );
        await deps.refreshOfflineCount();
      });
      return;
    }

    await run("Payment failed", async () => {
      const res = await checkout({
        ...checkoutRequest(method),
        cashReceived: p.cashReceived,
        arkToUse: method === "ark_coin" ? arkCapped : 0,
        giftCardBuyer: session.giftCardBuyer,
        xenditQrId: p.xenditQrId,
        xenditExternalId: p.xenditExternalId,
        paymentMethodCode: p.paymentMethodCode,
        paymentMethodName: p.paymentMethodName,
        supervisorPin: foc ? focPin : undefined,
      });
      if (!res.success) {
        toast.error(res.error || "Payment failed");
        return;
      }
      // EPIC-034 Fase B: order lunas tapi kartu gagal terbit, kasir wajib tahu.
      if (res.giftCardError) toast.error(res.giftCardError, { duration: 15000 });
      finishPayment({
        ...receiptBase(receiptMethod),
        orderId: res.orderId,
        orderNumber: res.orderNumber,
        checkoutNumber: res.checkoutNumber,
        queueNumber: res.queueNumber || null,
        total: res.total,
        change: res.change,
        chargesBreakdown: billCharges.breakdown,
        giftCards: res.giftCards,
        // EPIC-041: blok ARK & XP di struk dari snapshot respons pembayaran.
        arkPaid: method === "ark_coin" ? arkCapped : 0,
        arkBalanceAfter: res.arkBalanceAfter ?? null,
        xpEarned: deps.xpEnabled ? res.xpEarned : undefined,
        xpTotalAfter: deps.xpEnabled ? (res.xpTotalAfter ?? null) : null,
        ...receiptExtras,
        ...(foc ? focReceiptFields(res.total, res.compApprovedName) : {}),
      });
      toast.success(
        res.queueNumber ? `Pembayaran berhasil — Antrian ${res.queueNumber}` : "Pembayaran berhasil"
      );
      dispatch({ type: "giftCardBuyerSet", buyer: null });
      if (customer) deps.refetchCustomers();
    });
  };

  /** Checkout multi-stall: dibuat 'unpaid' dulu supaya QR terikat ke checkout_id. */
  const prepareMixedQrisCheckout = async () => {
    const res = await checkout({
      ...checkoutRequest("qris"),
      cashReceived: "",
      arkToUse: 0,
      paymentMethodCode: "qris",
      paymentMethodName: "QRIS",
      paymentStatus: "unpaid",
    });
    if (!res.success || !res.checkoutId) {
      throw new Error(res.error || "Gagal menyiapkan checkout QRIS");
    }
    return {
      checkout_id: res.checkoutId,
      checkout_number: res.checkoutNumber,
      queue_number: res.queueNumber ?? null,
    };
  };

  return {
    submitting: session.processing || submitting,
    confirmPayment,
    prepareMixedQrisCheckout,
  };
}
