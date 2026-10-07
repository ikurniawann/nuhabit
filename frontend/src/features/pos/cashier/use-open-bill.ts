"use client";

/**
 * Open bill dari kasir: simpan / tambah item ke checkout berjalan (tombol
 * Order), order 'unpaid' utk QRIS jual instan, kode promo, dan pembatalan.
 */

import { useEffect, type Dispatch } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { usePosCart } from "@/hooks/use-pos-cart";
import { updateOrderStatus, type CustomerWithDiscount } from "@/lib/pos-api";
import { newCartItemsForOpenBillAppend } from "@/lib/pos/table-sale-target";
import { checkPromoCode, openBill } from "./api";
import { discountReasonLabel, openBillItems, type CashierBill } from "./checkout";
import type { CashierSessionAction, CashierSessionState } from "./cashier-session";
import { readLastOpenCheckoutId, writeLastOpenCheckoutId } from "./last-open-checkout";
import { CASHIER_ID } from "./constants";

export function useOpenBillActions(deps: {
  cart: ReturnType<typeof usePosCart>;
  session: CashierSessionState;
  dispatch: Dispatch<CashierSessionAction>;
  bill: CashierBill;
  customer: CustomerWithDiscount | null;
  tableId: string | null;
  guestCount: number;
  shiftId: string | null;
  isOnline: boolean;
  paymentCheckoutId: string | null;
  fromRestaurant: boolean;
  restaurantPath: string;
  requireActiveShift: () => boolean;
}) {
  const router = useRouter();
  const { cart, session, dispatch, bill, customer } = deps;
  const { stack, billCharges, total } = bill;
  const promo = session.promo.applied;
  const offerDiscount = stack.offer_amount;

  useEffect(() => {
    writeLastOpenCheckoutId(deps.paymentCheckoutId);
  }, [deps.paymentCheckoutId]);

  const openBillTotals = {
    discount_reason: discountReasonLabel(bill.discount),
    manual_discount_type: cart.manual_discount_type,
    manual_discount_value: cart.manual_discount_value,
    membership_discount_pct: bill.discount.membershipPct,
  };

  /** Simpan open bill, atau tambah item baru ke checkout yang sedang berjalan. */
  const saveOpenBill = async () => {
    if (cart.items.length === 0) return;
    if (!deps.requireActiveShift()) return;
    const continueCheckoutId =
      deps.paymentCheckoutId || readLastOpenCheckoutId() || undefined;
    const appendItems = newCartItemsForOpenBillAppend({
      items: cart.items,
      persistedItemIds: session.bill.persistedItemIds,
    });
    const isAppend = Boolean(continueCheckoutId && session.bill.persistedItemIds.length > 0);
    if (isAppend && appendItems.length === 0) {
      toast.message("Belum ada item baru — tambah menu lalu Order lagi");
      return;
    }
    const sendItems = isAppend ? appendItems : cart.items;
    const sendSubtotal = sendItems.reduce(
      (sum, item) => sum + Number(item.price) * Number(item.quantity),
      0
    );
    dispatch({ type: "savingBillChanged", saving: true });
    try {
      const res = await openBill({
        order_type: cart.orderType,
        customer_id: customer?.id,
        cashier_id: CASHIER_ID,
        server_id: undefined,
        table_id: deps.tableId || undefined,
        checkout_id: continueCheckoutId,
        guest_count: deps.guestCount,
        shift_id: deps.shiftId || undefined,
        items: openBillItems(sendItems),
        subtotal: isAppend ? sendSubtotal : stack.gross_subtotal,
        discount_amount: isAppend ? 0 : stack.discount_amount,
        ...openBillTotals,
        promo_discount: isAppend ? 0 : (promo?.discount ?? 0),
        promo_code: isAppend ? undefined : promo?.code,
        offer_discount: isAppend ? 0 : offerDiscount,
        tax_amount: isAppend ? 0 : billCharges.tax_amount,
        service_charge_amount: isAppend ? 0 : billCharges.service_charge_amount,
        other_charges_amount: isAppend ? 0 : billCharges.other_charges_amount,
        charges_breakdown: isAppend ? [] : billCharges.breakdown,
        total_amount: isAppend ? sendSubtotal : total,
        notes: cart.notes,
      });
      if (!res.success || !res.data) {
        toast.error(res.error || "Failed to save open bill");
        return;
      }
      const data = res.data as typeof res.data & { checkout_id?: string; checkout_number?: string };
      if (data.checkout_id) writeLastOpenCheckoutId(data.checkout_id);
      const number = data.checkout_number || data.order_number;
      toast.success(
        isAppend
          ? `Item ditambahkan ke ${number}`
          : data.queue_number
            ? `Open bill tersimpan — Antrian ${data.queue_number}`
            : `Open bill tersimpan — ${number}`
      );
      dispatch({
        type: "openBillSaved",
        appendedItemIds: isAppend ? appendItems.map((item) => item.id) : null,
      });
      if (!isAppend) {
        cart.clearCart();
        if (deps.fromRestaurant) router.push(deps.restaurantPath);
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to save open bill");
    } finally {
      dispatch({ type: "savingBillChanged", saving: false });
    }
  };

  /**
   * Bug #5 fix (insiden 2026-08-25): jual instan single-stall via QRIS. Order
   * dibuat 'unpaid' DULU (item + stok diklaim lewat endpoint open bill), baru
   * QR diikat ke order itu; bila settle gagal setelah customer bayar, order
   * tetap ada, bukan orphan.
   */
  const prepareOrderQris = async () => {
    const res = await openBill({
      order_type: cart.orderType,
      customer_id: customer?.id,
      table_id: deps.tableId || undefined,
      guest_count: deps.guestCount,
      reuse_unpaid_checkout: false,
      items: openBillItems(cart.items),
      subtotal: stack.gross_subtotal,
      discount_amount: stack.discount_amount,
      ...openBillTotals,
      tax_amount: billCharges.tax_amount,
      service_charge_amount: billCharges.service_charge_amount,
      other_charges_amount: billCharges.other_charges_amount,
      charges_breakdown: billCharges.breakdown,
      total_amount: total,
      notes: cart.notes,
      promo_discount: promo?.discount ?? 0,
      promo_code: promo?.code,
      offer_discount: offerDiscount,
      shift_id: deps.shiftId || undefined,
    });
    if (!res.success || !res.data?.id) {
      throw new Error(res.error || "Gagal menyiapkan order QRIS");
    }
    return {
      order_id: res.data.id,
      order_number: res.data.order_number,
      queue_number: res.data.queue_number ?? null,
    };
  };

  /** Batal QRIS sebelum bayar: 'cancelled' mengembalikan stok BOM/merchandise. */
  const abandonOrderQris = async (orderId: string) => {
    await updateOrderStatus(orderId, "cancelled", {
      cancelled_reason: "QRIS dibatalkan sebelum dibayar",
    }).catch((err) => {
      console.error(`[pos] abandon prepared QRIS order ${orderId} failed:`, err);
    });
  };

  /** EPIC-032 C2: pratinjau kode promo; kode pembuka penawaran mengaktifkan offer. */
  const applyPromo = async () => {
    const code = session.promo.input.trim();
    if (!code || session.promo.busy) return;
    if (!deps.isOnline) {
      dispatch({ type: "promoRejected", error: "Kode promo membutuhkan koneksi internet" });
      return;
    }
    dispatch({ type: "promoCheckStarted" });
    try {
      const result = await checkPromoCode({
        code,
        subtotal: cart.itemsSubtotal,
        // Nilai bersih per baris utk kode yang dibatasi produk/kategori.
        items: cart.items.map((item, index) => ({
          product_id: item.productId,
          amount: stack.line_results[index]?.total_amount ?? 0,
        })),
        customerId: cart.selectedCustomerId || null,
      });
      if (!result.ok) {
        dispatch({ type: "promoRejected", error: result.error });
      } else if (result.kind === "offer") {
        dispatch({
          type: "promoApplied",
          promo: { code: code.toUpperCase(), discount: 0, offerRuleId: result.ruleId },
        });
        toast.success(`Penawaran "${result.offerName}" aktif`);
      } else {
        dispatch({ type: "promoApplied", promo: { code: code.toUpperCase(), discount: result.discount } });
      }
    } catch {
      dispatch({ type: "promoRejected", error: "Jaringan bermasalah — coba lagi" });
    } finally {
      dispatch({ type: "promoCheckFinished" });
    }
  };

  return { saveOpenBill, prepareOrderQris, abandonOrderQris, applyPromo };
}
