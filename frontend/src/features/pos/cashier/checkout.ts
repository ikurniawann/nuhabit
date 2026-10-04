/**
 * Aturan dan payload checkout kasir (murni): tagihan, penolak pembayaran,
 * alasan diskon, baris struk, item open bill / offline, state layar customer.
 */

import { lineGross, type PosCartItem } from "@/hooks/use-pos-cart";
import type { ReceiptPayload } from "@/components/pos/PrintReceipt";
import {
  calculateBillCharges,
  resolveEnabledOptionalCodes,
  serviceToggleLabel,
  taxToggleLabel,
  type BillingCharge,
} from "@/lib/pos/billing-settings";
import {
  computeOrderDiscountStack,
  type DiscountType,
  type OrderDiscountStack,
} from "@/lib/pos/manual-discount";
import { idleCfdState, type CfdPayment, type CfdState } from "@/lib/pos/cfd";
import {
  MIXED_ARK_UNSUPPORTED_MESSAGE,
  MIXED_LINE_DISCOUNT_UNSUPPORTED_MESSAGE,
  MIXED_NFC_GIFT_UNSUPPORTED_MESSAGE,
  MIXED_PROMO_UNSUPPORTED_MESSAGE,
  isCheckoutBillUnsupportedTender,
  isMixedUnsupportedTender,
} from "@/lib/pos/central-cashier";
import { evaluateOfferRules, type OfferEvalRule } from "@/lib/promo/offer-evaluate";
import type { AppliedPromo } from "./cashier-session";

/** Tagihan: item → offer → membership → promo → manual, lalu pajak/service/biaya lain. */
function summarizeBill(input: {
  stack: OrderDiscountStack;
  charges: BillingCharge[];
  includeTax: boolean;
  includeService: boolean;
}) {
  const { stack, charges } = input;
  const billCharges = calculateBillCharges({
    subtotalAfterDiscount: stack.after_discount,
    charges,
    enabledOptionalCodes: resolveEnabledOptionalCodes(
      charges,
      input.includeTax,
      input.includeService
    ),
  });
  return {
    billCharges,
    total: billCharges.total,
    /** Basis diskon manual transaksi = setelah item, offer, member, promo. */
    manualDiscountBasis: Math.max(
      0,
      stack.items_subtotal - stack.offer_amount - stack.membership_amount - stack.promo_amount
    ),
    otherChargeLines: billCharges.breakdown
      .filter((line) => line.kind !== "tax" && line.kind !== "service")
      .map((line) => ({ code: line.code, name: line.name, amount: line.amount })),
    taxLabel: taxToggleLabel(charges),
    serviceLabel: serviceToggleLabel(charges),
  };
}

export interface DiscountContext {
  stack: OrderDiscountStack;
  offerNames: string[];
  membershipPct: number;
  promoCode: string | null;
  manualType: DiscountType | null;
  manualValue: number | null;
}

/** discount_reason open bill, mis. "ITEM line discounts; MEMBER 10%; PROMO HEMAT". */
export function discountReasonLabel(ctx: DiscountContext): string | undefined {
  const manual =
    ctx.manualType && ctx.manualValue
      ? ctx.manualType === "percent"
        ? `MANUAL ${ctx.manualValue}%`
        : `MANUAL Rp ${Math.floor(ctx.manualValue)}`
      : null;
  return (
    [
      ctx.stack.line_discount_total > 0 ? "ITEM line discounts" : null,
      ...ctx.offerNames.map((name) => `OFFER ${name}`),
      ctx.membershipPct > 0 ? `MEMBER ${ctx.membershipPct}%` : null,
      ctx.promoCode ? `PROMO ${ctx.promoCode}` : null,
      manual,
    ]
      .filter(Boolean)
      .join("; ") || undefined
  );
}

/** Rincian diskon per jenis di struk (redesign struk, owner 2026-08-16). */
export function receiptDiscountLines(ctx: DiscountContext) {
  const { stack } = ctx;
  const lines: Array<{ label: string; amount: number }> = [];
  if (stack.line_discount_total > 0) {
    lines.push({ label: "Diskon Item", amount: stack.line_discount_total });
  }
  if (stack.offer_amount > 0) {
    lines.push({
      label: ctx.offerNames.length === 1 ? `Promo ${ctx.offerNames[0]}` : "Penawaran",
      amount: stack.offer_amount,
    });
  }
  if (stack.membership_amount > 0) {
    lines.push({
      label: `Diskon Member (${ctx.membershipPct}%)`,
      amount: stack.membership_amount,
    });
  }
  if (stack.promo_amount > 0) {
    lines.push({
      label: ctx.promoCode ? `Promo ${ctx.promoCode}` : "Promo",
      amount: stack.promo_amount,
    });
  }
  if (stack.manual_amount > 0) {
    lines.push({
      label:
        ctx.manualType === "percent" ? `Diskon Manual (${ctx.manualValue}%)` : "Diskon Manual",
      amount: stack.manual_amount,
    });
  }
  return lines;
}

/** Item open bill: harga dasar + penyesuaian varian/modifier dipisah utk validasi server. */
export function openBillItems(items: PosCartItem[]) {
  return items.map((item) => ({
    product_id: item.productId,
    sku_id: item.skuId,
    product_name: item.name,
    product_sku: item.skuCode || item.productId,
    variants: item.variantName
      ? [{ name: item.variantName, group: "Size", price: item.variantPriceAdj || 0 }]
      : [],
    modifiers: item.modifierNames?.map((name, idx) => ({ name, group: `Option-${idx}` })) || [],
    quantity: Number(item.quantity),
    unit_price: Number(item.price - (item.variantPriceAdj || 0) - (item.modifierPriceAdj || 0)),
    variant_price_adjustment: item.variantPriceAdj || 0,
    modifier_price_adjustment: item.modifierPriceAdj || 0,
    subtotal: Number(item.price * item.quantity),
    discount_type: item.discount_type ?? null,
    discount_value: item.discount_value ?? null,
    discount_amount: 0,
    total_amount: Number(item.price * item.quantity),
    station: item.station,
    kitchen_notes: item.notes,
  }));
}

/** Item order offline: harga final per unit (disinkron nanti oleh usePosOfflineQueue). */
export function offlineOrderItems(items: PosCartItem[]) {
  return items.map((item) => ({
    product_id: item.productId,
    sku_id: item.skuId,
    product_name: item.name,
    product_sku: item.skuCode || item.productId,
    quantity: item.quantity,
    unit_price: item.price,
    subtotal: item.price * item.quantity,
    total_amount: item.price * item.quantity,
  }));
}

/** Metode offline yang dipetakan ke enum order; sisanya dicatat sebagai tunai. */
export function offlinePaymentMethod(method: string) {
  if (method === "qris") return "qris";
  if (method === "credit_card") return "credit";
  if (method === "ark_coin") return "ark_coin";
  return "cash";
}

export function cashChange(method: string, cashReceived: string, payTotal: number) {
  return method === "cash" ? (parseFloat(cashReceived) || 0) - payTotal : 0;
}

/** FOC = komplimen: struk total 0, diskon 100% dari tagihan, label penyetuju. */
export function focReceiptFields(
  billed: number,
  approvedName: string | null | undefined
): Partial<ReceiptPayload> {
  return {
    total: 0,
    change: 0,
    discountAmount: billed,
    compType: "foc_comp",
    compApprovedName: approvedName ?? null,
  };
}

/** EPIC-024: snapshot keranjang/pembayaran utk layar customer. */
export function cfdCartState(input: {
  items: PosCartItem[];
  subtotal: number;
  discount: number;
  tax: number;
  arkUsed: number;
  total: number;
  payment: CfdPayment | null;
  memberName: string | null;
  now?: number;
}): CfdState {
  const now = input.now ?? Date.now();
  if (input.items.length === 0 && !input.payment) return idleCfdState(now);
  return {
    status: input.payment ? "payment" : "cart",
    items: input.items.map((item) => ({
      name: item.name,
      qty: item.quantity,
      unit_price: item.price,
      line_total: Math.round(item.price * item.quantity),
    })),
    subtotal: input.subtotal,
    discount: input.discount,
    tax: input.tax,
    ark_used: input.arkUsed,
    total: input.total,
    payment: input.payment,
    member_name: input.memberName,
    updated_at: now,
  };
}

/**
 * Tagihan keranjang lengkap: offer → diskon bertumpuk → biaya → batas ARK.
 * `arkToUse` = tender ARK terakhir; dibatasi saldo member dan total.
 */
export function computeCashierBill(input: {
  items: PosCartItem[];
  offerRules: Array<OfferEvalRule | null | undefined>;
  promo: AppliedPromo | null;
  membershipPct: number;
  manualType: DiscountType | null;
  manualValue: number | null;
  charges: BillingCharge[];
  includeTax: boolean;
  includeService: boolean;
  arkBalance: number | null;
  arkToUse: number;
}) {
  const rules = input.offerRules.filter((rule): rule is OfferEvalRule => Boolean(rule));
  const offerEval =
    rules.length === 0 || input.items.length === 0
      ? { offer_discount: 0, applied: [] as ReturnType<typeof evaluateOfferRules>["applied"] }
      : evaluateOfferRules(
          input.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.price,
          })),
          rules,
          {
            channel: "pos",
            unlockedRuleIds: input.promo?.offerRuleId ? [input.promo.offerRuleId] : [],
          }
        );
  const stack = computeOrderDiscountStack({
    items: input.items.map((item) => ({
      line_subtotal: lineGross(item),
      discount_type: item.discount_type,
      discount_value: item.discount_value,
    })),
    offer_discount: offerEval.offer_discount,
    membership_pct: input.membershipPct,
    promo_discount: input.promo?.discount ?? 0,
    manual_discount_type: input.manualType,
    manual_discount_value: input.manualValue,
  });
  const summary = summarizeBill({
    stack,
    charges: input.charges,
    includeTax: input.includeTax,
    includeService: input.includeService,
  });
  const maxArkUsable = input.arkBalance == null ? 0 : Math.min(input.arkBalance, summary.total);
  const arkToUseCapped = Math.min(input.arkToUse, maxArkUsable);
  const discount: DiscountContext = {
    stack,
    offerNames: offerEval.applied.map((offer) => offer.name),
    membershipPct: input.membershipPct,
    promoCode: input.promo?.code ?? null,
    manualType: input.manualType,
    manualValue: input.manualValue,
  };
  return {
    ...summary,
    stack,
    offerEval,
    discount,
    maxArkUsable,
    arkToUseCapped,
    totalAfterArk: summary.total - arkToUseCapped,
  };
}

export type CashierBill = ReturnType<typeof computeCashierBill>;

/**
 * Penolak pembayaran sebelum ke server, urutan = prioritas pesan.
 * FOC butuh customer + PIN + koneksi; checkout multi-stall menolak NFC/gift,
 * promo, dan diskon per item; tagihan checkout menolak ARK/NFC/gift.
 */
export function paymentBlocker(input: {
  method: string;
  foc: boolean;
  hasCustomer: boolean;
  supervisorPin: string;
  isOnline: boolean;
  mixedCart: boolean;
  hasPromo: boolean;
  itemDiscountTotal: number;
  payingCheckoutBill: boolean;
  preparedCheckoutId?: string;
}): string | null {
  if (input.foc && !input.hasCustomer) {
    return "Metode FOC membutuhkan customer/member — pilih customer dulu";
  }
  if (input.foc && !input.supervisorPin) return "Metode FOC membutuhkan PIN supervisor";
  if (input.foc && !input.isOnline) {
    return "Metode FOC membutuhkan koneksi — PIN supervisor diverifikasi server";
  }
  if (input.mixedCart && isMixedUnsupportedTender(input.method)) {
    return MIXED_NFC_GIFT_UNSUPPORTED_MESSAGE;
  }
  // Diskon transaksi lolos (server membaginya pro-rata per stall).
  if (input.mixedCart && input.hasPromo) return MIXED_PROMO_UNSUPPORTED_MESSAGE;
  if (input.mixedCart && input.itemDiscountTotal > 0) {
    return MIXED_LINE_DISCOUNT_UNSUPPORTED_MESSAGE;
  }
  if (input.payingCheckoutBill && isCheckoutBillUnsupportedTender(input.method)) {
    return input.method === "ark_coin"
      ? MIXED_ARK_UNSUPPORTED_MESSAGE
      : MIXED_NFC_GIFT_UNSUPPORTED_MESSAGE;
  }
  if (input.mixedCart && !input.isOnline && !input.preparedCheckoutId) {
    return "Checkout multi-stall membutuhkan koneksi";
  }
  return null;
}
