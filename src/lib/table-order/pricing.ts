/**
 * Keranjang & perhitungan tagihan self-order meja.
 *
 * Pajak/service TIDAK lagi hardcode 10% — dihitung dari profil billing venue
 * (`pos_billing_profiles`, lib/pos/billing-settings) yang sama dengan kasir,
 * supaya total yang dilihat pemesan == total yang disimpan server & struk.
 */

import {
  calculateBillCharges,
  type BillingCharge,
  type ChargeBreakdownLine,
} from "@/lib/pos/billing-settings";
import {
  resolveVariant,
  unitPriceFor,
  type SelectedModifier,
  type TableOrderProduct,
  type TableOrderVariant,
} from "./menu";
import { memberDiscountAmount } from "@/lib/pos/member-price";

export { memberDiscountAmount, memberPrice } from "@/lib/pos/member-price";

export type CartLine = {
  cartId: string;
  productId: string;
  name: string;
  image: string | null;
  variantId: string | null;
  variantName: string | null;
  /** Add-on terpilih — id dikirim ke server (harga dihitung ulang di sana). */
  modifierIds: string[];
  modifierNames: string[];
  unitPrice: number;
  quantity: number;
  xp: number;
  station: string;
  stationLabel: string;
};

export type CartSummary = {
  totalItems: number;
  subtotal: number;
  /** Potongan diskon tier member (0 bila tamu). */
  memberDiscount: number;
  memberDiscountPercent: number;
  totalXp: number;
  taxAmount: number;
  serviceChargeAmount: number;
  otherChargesAmount: number;
  total: number;
  breakdown: ChargeBreakdownLine[];
};

export const MAX_LINE_QTY = 99;

/** Kombinasi produk + varian + add-on = satu baris; urutan pilihan add-on tak berpengaruh. */
export function cartLineId(productId: string, variantId?: string | null, modifierIds: readonly string[] = []) {
  const base = variantId ? `${productId}:${variantId}` : productId;
  return modifierIds.length ? `${base}+${[...modifierIds].sort().join(",")}` : base;
}

export function addToCart(
  cart: CartLine[],
  product: TableOrderProduct,
  variant: TableOrderVariant | null = resolveVariant(product, null),
  quantity = 1,
  modifiers: SelectedModifier[] = []
): CartLine[] {
  const qty = Math.max(1, Math.min(MAX_LINE_QTY, Math.round(quantity)));
  const modifierIds = modifiers.map((modifier) => modifier.id);
  const cartId = cartLineId(product.id, variant?.id, modifierIds);
  const existing = cart.find((line) => line.cartId === cartId);
  if (existing) {
    return cart.map((line) =>
      line.cartId === cartId
        ? { ...line, quantity: Math.min(MAX_LINE_QTY, line.quantity + qty) }
        : line
    );
  }
  return [
    ...cart,
    {
      cartId,
      productId: product.id,
      name: product.name,
      image: product.image,
      variantId: variant?.id ?? null,
      variantName: variant?.name ?? null,
      modifierIds,
      modifierNames: modifiers.map((modifier) => modifier.name),
      unitPrice: unitPriceFor(product, variant, modifiers),
      quantity: qty,
      xp: product.xp,
      station: product.station,
      stationLabel: product.stationLabel,
    },
  ];
}

/** qty ≤ 0 → baris dihapus. */
export function setCartQuantity(cart: CartLine[], cartId: string, quantity: number): CartLine[] {
  const qty = Math.min(MAX_LINE_QTY, Math.round(quantity));
  return cart
    .map((line) => (line.cartId === cartId ? { ...line, quantity: qty } : line))
    .filter((line) => line.quantity > 0);
}

export function adjustCartQuantity(cart: CartLine[], cartId: string, delta: number) {
  const line = cart.find((item) => item.cartId === cartId);
  if (!line) return cart;
  return setCartQuantity(cart, cartId, line.quantity + delta);
}

/** Jumlah unit satu produk di keranjang (semua varian) — utk stepper di daftar menu. */
export function productQuantity(cart: CartLine[], productId: string) {
  return cart
    .filter((line) => line.productId === productId)
    .reduce((sum, line) => sum + line.quantity, 0);
}

export function summarizeCart(
  cart: CartLine[],
  charges: BillingCharge[] = [],
  memberDiscountPercent = 0
): CartSummary {
  const subtotal = cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const totalItems = cart.reduce((sum, line) => sum + line.quantity, 0);
  const totalXp = cart.reduce((sum, line) => sum + line.xp * line.quantity, 0);
  const memberDiscount = memberDiscountAmount(subtotal, memberDiscountPercent);
  const bill = calculateBillCharges({ subtotalAfterDiscount: subtotal - memberDiscount, charges });
  return {
    totalItems,
    subtotal,
    memberDiscount,
    memberDiscountPercent: memberDiscount > 0 ? memberDiscountPercent : 0,
    totalXp,
    taxAmount: bill.tax_amount,
    serviceChargeAmount: bill.service_charge_amount,
    otherChargesAmount: bill.other_charges_amount,
    total: bill.total,
    breakdown: bill.breakdown,
  };
}
