// One-screen checkout: pure rules (no I/O) for delivery, promo, totals and
// the checkout payload.

import { formatRupiah } from "@/lib/format";
import type { CartLine } from "./storefront-cart";
import type { AppliedPromo, DeliveryMethod, PaymentMethod, PickupBranch, ShopMember } from "./types";

/** Rupiah left before free shipping; 0 once unlocked; null without a threshold. */
export function freeShippingRemaining(subtotal: number, threshold: number | null): number | null {
  if (threshold === null || threshold <= 0) return null;
  return Math.max(0, threshold - subtotal);
}

/** Progress bar copy and fill ratio for the cart. */
export function freeShippingProgress(
  subtotal: number,
  threshold: number | null
): { text: string; ratio: number; unlocked: boolean } | null {
  const remaining = freeShippingRemaining(subtotal, threshold);
  if (remaining === null || threshold === null) return null;
  if (remaining === 0) return { text: "You've unlocked free shipping", ratio: 1, unlocked: true };
  return {
    text: `${formatRupiah(remaining)} away from free shipping`,
    ratio: Math.min(1, subtotal / threshold),
    unlocked: false,
  };
}

export type CheckoutTotals = {
  subtotal: number;
  discount: number;
  shipping: number;
  freeShipping: boolean;
  total: number;
};

/**
 * Totals shown in the cart and the checkout summary. Pickup ships free;
 * a shipped order ships free once the subtotal reaches the threshold. The
 * discount never exceeds the subtotal.
 */
export function checkoutTotals(input: {
  lines: CartLine[];
  promo: AppliedPromo | null;
  method: DeliveryMethod;
  rateCost: number | null;
  freeShippingThreshold: number | null;
}): CheckoutTotals {
  const subtotal = input.lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
  const discount = Math.min(subtotal, Math.max(0, input.promo?.discountAmount ?? 0));
  const freeShipping =
    input.method === "ship" && freeShippingRemaining(subtotal, input.freeShippingThreshold) === 0;
  const shipping = input.method === "pickup" || freeShipping ? 0 : (input.rateCost ?? 0);
  return { subtotal, discount, shipping, freeShipping, total: subtotal - discount + shipping };
}

/** ARK Coin pays the whole total: a member session with enough balance. */
export function arkCoinAvailable(member: ShopMember | null | undefined, total: number): boolean {
  return Boolean(member) && (member?.arkBalance ?? 0) >= total && total > 0;
}

export type CheckoutDraft = {
  name: string;
  phone: string;
  email: string;
  method: DeliveryMethod;
  branchId: string | null;
  address: string;
  hasArea: boolean;
  hasRate: boolean;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** First error message for the checkout sheet, or null when ready to pay. */
export function checkoutDraftError(draft: CheckoutDraft, branches: PickupBranch[]): string | null {
  if (draft.name.trim().length < 2) return "Your name is required";
  if (draft.phone.replace(/\D/g, "").length < 8) return "Enter a valid WhatsApp number";
  if (draft.email.trim() && !EMAIL_RE.test(draft.email.trim())) return "Enter a valid email address or leave it blank";
  if (draft.method === "pickup") {
    if (!draft.branchId || !branches.some((branch) => branch.id === draft.branchId)) return "Choose a branch for pickup";
    return null;
  }
  if (!draft.hasArea) return "Choose a destination area first";
  if (draft.address.trim().length < 10) return "Full address must be at least 10 characters";
  if (!draft.hasRate) return "Choose a courier first";
  return null;
}

export type CheckoutPayload = {
  items: Array<{ product_id: string; sku_id: string | null; quantity: number }>;
  customer: { name: string; phone: string; email: string | null };
  delivery: { method: DeliveryMethod; branchId?: string };
  destination?: { area_id: string; label: string; postal_code: string | null; address: string };
  courier?: { code: string; service_code: string };
  promoCode?: string;
  payment: { method: PaymentMethod };
  notes: string | null;
};

/** The POST /checkout body; pickup carries no destination or courier. */
export function buildCheckoutPayload(input: {
  lines: CartLine[];
  customer: { name: string; phone: string; email: string };
  method: DeliveryMethod;
  branchId: string | null;
  area: { id: string; label: string; postalCode: string | null } | null;
  address: string;
  courier: { code: string; serviceCode: string } | null;
  promo: AppliedPromo | null;
  payment: PaymentMethod;
  note: string;
}): CheckoutPayload {
  const payload: CheckoutPayload = {
    items: input.lines.map((line) => ({ product_id: line.productId, sku_id: line.skuId, quantity: line.quantity })),
    customer: {
      name: input.customer.name.trim(),
      phone: input.customer.phone.trim(),
      email: input.customer.email.trim() || null,
    },
    delivery: input.method === "pickup" && input.branchId
      ? { method: "pickup", branchId: input.branchId }
      : { method: "ship" },
    payment: { method: input.payment },
    notes: input.note.trim() || null,
  };
  if (input.method === "ship" && input.area && input.courier) {
    payload.destination = {
      area_id: input.area.id,
      label: input.area.label,
      postal_code: input.area.postalCode,
      address: input.address.trim(),
    };
    payload.courier = { code: input.courier.code, service_code: input.courier.serviceCode };
  }
  if (input.promo) payload.promoCode = input.promo.code;
  return payload;
}

/** The lines a promo preview is quoted for; a changed cart needs a new preview. */
export function promoLines(lines: CartLine[]) {
  return lines.map((line) => ({ productId: line.productId, skuId: line.skuId, quantity: line.quantity }));
}
