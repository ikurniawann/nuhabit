"use client";

import { useState, useCallback } from "react";
import { createCheckout, createOrder, type CreateOrderRequest } from "@/lib/pos-api";
import {
  mapPaidSaleToReceiptIds,
  resolveCheckoutApi,
  uniqueStallIds,
} from "@/lib/pos/central-cashier";
import type { BillChargesResult } from "@/lib/pos/billing-settings";
import {
  buildDiscountReason,
  computeOrderDiscountStack,
  type DiscountType,
} from "@/lib/pos/manual-discount";
import { lineGross, type PosCartItem } from "./use-pos-cart";

export interface PaymentResult {
  success: boolean;
  orderId?: string;
  orderNumber?: string;
  checkoutId?: string;
  checkoutNumber?: string;
  queueNumber?: string | null;
  total: number;
  change: number;
  error?: string;
  snapshotCart: PosCartItem[];
  snapshotOrderType: string;
  snapshotTable: string | null;
  snapshotNotes: string;
  xpEarned?: number;
  /** EPIC-041 — saldo ARK (Rupiah) setelah potong & total XP member, utk struk. */
  arkBalanceAfter?: number | null;
  xpTotalAfter?: number | null;
  /** EPIC-034 Fase B — kartu yang terbit dari order ini (kode dicetak struk). */
  giftCards?: Array<{ code: string; initial_value: number; expires_at: string | null }>;
  /** Terisi bila order LUNAS tapi kartu gagal terbit — wajib ditampilkan. */
  giftCardError?: string | null;
  /** Metode FOC — nama supervisor penyetuju dari server, utk label struk. */
  compApprovedName?: string | null;
}

export function usePosCheckout() {
  const [submitting, setSubmitting] = useState(false);

  const checkout = useCallback(
    async ({
      cart,
      orderType,
      selectedTable,
      selectedCustomer,
      paymentMethod,
      cashReceived,
      includeTax,
      notes,
      arkToUse,
      shiftId,
      nfcTabUid,
      giftCardCode,
      giftCardBuyer,
      promo,
      billCharges,
      manualDiscountType,
      manualDiscountValue,
      offerDiscount,
      offerLabels,
      paymentStatus,
      xenditQrId,
      xenditExternalId,
      paymentMethodCode,
      paymentMethodName,
      supervisorPin,
    }: {
      cart: PosCartItem[];
      orderType: string;
      selectedTable: string | null;
      selectedCustomer: { id: string; discount?: number; is_kol?: boolean } | null;
      paymentMethod: string;
      cashReceived: string;
      includeTax: boolean;
      notes: string;
      arkToUse: number;
      shiftId?: string | null;
      /** UID gelang ticketing — wajib saat paymentMethod 'nfc_tab' */
      nfcTabUid?: string;
      /** EPIC-034 Fase C — kode kartu, wajib saat paymentMethod 'gift_card' */
      giftCardCode?: string;
      /** EPIC-034 Fase B — pembeli gift card; nomor dipakai kirim kode via WA */
      giftCardBuyer?: { name?: string | null; phone?: string | null } | null;
      /** EPIC-032 C2 — kode promo ter-apply (diskon preview dari server). */
      promo?: { code: string; discount: number } | null;
      /** Resolved billing totals from calculateBillCharges */
      billCharges: BillChargesResult;
      manualDiscountType?: DiscountType | null;
      manualDiscountValue?: number | null;
      /** Product offers (bundle/bxgy/volume) already evaluated on client */
      offerDiscount?: number;
      offerLabels?: string[];
      paymentStatus?: "paid" | "unpaid";
      xenditQrId?: string;
      xenditExternalId?: string;
      paymentMethodCode?: string;
      paymentMethodName?: string;
      /** PIN supervisor — wajib saat metode bayar FOC (diverifikasi server). */
      supervisorPin?: string;
    }): Promise<PaymentResult> => {
      const snap = {
        snapshotCart: [...cart],
        snapshotOrderType: orderType,
        snapshotTable: selectedTable,
        snapshotNotes: notes,
      };

      try {
        setSubmitting(true);

        // Build item payload with price adjustments broken out for server validation
        const items = cart.map((item, index) => {
          const line_subtotal = lineGross(item);
          return {
            product_id: item.productId,
            sku_id: item.skuId,
            product_name: item.name,
            product_sku: item.skuCode || `SKU-${item.productId}`,
            variants: item.variantName
              ? [{ name: item.variantName, group: "Size", price: item.variantPriceAdj || 0 }]
              : [],
            modifiers:
              item.modifierNames?.map((name, idx) => ({
                name,
                group: `Option-${idx}`,
              })) || [],
            station: item.station,
            quantity: Number(item.quantity),
            unit_price: Number(
              item.price - (item.variantPriceAdj || 0) - (item.modifierPriceAdj || 0)
            ),
            variant_price_adjustment: item.variantPriceAdj || 0,
            modifier_price_adjustment: item.modifierPriceAdj || 0,
            subtotal: Number(line_subtotal),
            discount_type: item.discount_type ?? null,
            discount_value: item.discount_value ?? null,
            discount_amount: 0, // filled after stack
            total_amount: Number(line_subtotal),
            _index: index,
          };
        });

        const discountPct = selectedCustomer?.discount || 0;
        const stack = computeOrderDiscountStack({
          items: cart.map((item) => ({
            line_subtotal: lineGross(item),
            discount_type: item.discount_type,
            discount_value: item.discount_value,
          })),
          offer_discount: offerDiscount ?? 0,
          membership_pct: discountPct,
          promo_discount: promo?.discount ?? 0,
          manual_discount_type: manualDiscountType,
          manual_discount_value: manualDiscountValue,
        });

        for (let i = 0; i < items.length; i++) {
          const line = stack.line_results[i];
          items[i].discount_amount = line.discount_amount;
          items[i].total_amount = line.total_amount;
          delete (items[i] as { _index?: number })._index;
        }

        const subtotal = stack.gross_subtotal;
        const discountAmount = stack.discount_amount;
        const discountReason = buildDiscountReason({
          has_item_discounts: stack.line_discount_total > 0,
          offer_labels: offerLabels,
          membership_pct: discountPct,
          promo_code: promo?.code,
          manual_type: manualDiscountType,
          manual_value: manualDiscountValue,
        });
        const tax = billCharges.tax_amount;
        const total = billCharges.total;
        const paidAmount =
          paymentMethod === "cash"
            ? Number(parseFloat(cashReceived) || total)
            : paymentMethod === "nfc_tab"
              ? 0 // tagihan pindah ke tab ticketing — kasir tidak menerima uang
              : paymentMethod === "gift_card"
                ? 0 // dibayar dari saldo kartu — laci kasir tidak menerima uang
                : total;

        const useCheckout =
          resolveCheckoutApi(uniqueStallIds(cart.map((item) => item.warehouse_id))) ===
          "checkout";
        const payload: CreateOrderRequest = {
          order_type: orderType as CreateOrderRequest["order_type"],
          customer_id: selectedCustomer?.id,
          cashier_id: "00000000-0000-0000-0000-000000000001",
          table_id: selectedTable || undefined,
          items,
          subtotal,
          discount_amount: discountAmount,
          discount_reason: discountReason || undefined,
          manual_discount_type: manualDiscountType ?? null,
          manual_discount_value: manualDiscountValue ?? null,
          tax_amount: tax,
          service_charge_amount: billCharges.service_charge_amount,
          other_charges_amount: billCharges.other_charges_amount,
          charges_breakdown: billCharges.breakdown,
          total_amount: total,
          payment_method: paymentMethod === "qris" ? "qris" : paymentMethod === "credit_card" ? "credit" : paymentMethod === "ark_coin" ? "ark_coin" : paymentMethod === "nfc_tab" ? "nfc_tab" : paymentMethod === "gift_card" ? "gift_card" : "cash",
          amount_paid: paidAmount,
          include_tax: includeTax,
          membership_discount_pct: discountPct,
          promo_code: promo?.code,
          notes,
          ark_coins_used: paymentMethod === "ark_coin" ? arkToUse : 0,
          shift_id: shiftId || undefined,
          nfc_tab_uid: paymentMethod === "nfc_tab" ? nfcTabUid : undefined,
          gift_card_code: paymentMethod === "gift_card" ? giftCardCode : undefined,
          gift_card_buyer_name: giftCardBuyer?.name || undefined,
          gift_card_buyer_phone: giftCardBuyer?.phone || undefined,
          xendit_qr_id: xenditQrId,
          xendit_external_id: xenditExternalId,
          payment_method_code: paymentMethodCode,
          payment_method_name: paymentMethodName,
          supervisor_pin: supervisorPin || undefined,
          // EPIC-043: customer KOL + order digratiskan penuh oleh kasir →
          // otomatis distempel komplimen KOL (server memvalidasi flag+kuota).
          ...(selectedCustomer?.is_kol && total === 0 && subtotal > 0
            ? { comp_type: 'kol_comp' }
            : {}),
        };

        const response = useCheckout
          ? await createCheckout({
              ...payload,
              payment_status: paymentStatus ?? (paymentMethod === "qris" ? "unpaid" : "paid"),
            })
          : await createOrder(payload);

        if (!response.success) {
          return { success: false, total, change: 0, error: response.error || "Gagal membuat order", ...snap };
        }

        const change = paymentMethod === "cash" ? (parseFloat(cashReceived) || 0) - total : 0;
        // EPIC-041: snapshot struk dari respons pembayaran (bukan fetch kedua).
        // XP transaksi diambil dari crm_xp — pos_orders tidak punya kolom
        // xp_earned, jadi data.xp_earned selalu undefined.
        const extras = response as unknown as {
          ark_balance_after?: number | null;
          xp_total_after?: number | null;
          crm_xp?: { xpAwarded?: number };
        };
        const data = (response.data || {}) as {
          checkout_id?: string;
          checkout_number?: string;
          queue_number?: string | null;
          order_ids?: string[];
          order_id?: string;
          id?: string;
          order_number?: string;
          xp_earned?: number;
          comp_approved_name?: string | null;
        };
        const ids = mapPaidSaleToReceiptIds(data);

        return {
          success: true,
          orderId: ids.orderId,
          orderNumber: ids.orderNumber,
          checkoutId: data.checkout_id,
          checkoutNumber: ids.checkoutNumber,
          queueNumber: ids.queueNumber ?? data.queue_number ?? null,
          total,
          change,
          xpEarned: data.xp_earned ?? extras.crm_xp?.xpAwarded,
          arkBalanceAfter: extras.ark_balance_after ?? null,
          xpTotalAfter: extras.xp_total_after ?? null,
          giftCards: "gift_cards" in response ? response.gift_cards : undefined,
          giftCardError: "gift_card_error" in response ? response.gift_card_error ?? null : null,
          compApprovedName: data.comp_approved_name ?? null,
          ...snap,
        };
      } catch (err: unknown) {
        return {
          success: false,
          total: 0,
          change: 0,
          error: err instanceof Error ? err.message : "Network error",
          ...snap,
        };
      } finally {
        setSubmitting(false);
      }
    },
    []
  );

  return { checkout, submitting };
}
