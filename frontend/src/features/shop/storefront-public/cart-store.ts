"use client";

// The public storefront cart as a small store outside React, so the site
// shell (item count badge, open-cart button) and the store page share one
// source.
//
// localStorage:
//   `shop-cart-<slug>`      JSON { lines: CartLine[], note: string, promo: AppliedPromo | null }
//                           per store. The old format (an array of CartLine) still reads.
//   `shop-cart-active`      slug of the last store opened, so the badge outside
//                           the store page knows which cart to count.
//   `shop-checkout-contact` JSON CheckoutContact: name, phone, email and the last
//                           shipping address, prefilled on the next checkout.

import { useEffect, useSyncExternalStore } from "react";
import { cartCount, parseStoredCart, type CartLine } from "@/lib/shop/storefront-cart";
import type { AppliedPromo } from "@/lib/shop/types";

export type CartState = {
  /** Slug of the store whose cart is held; null before any store loads. */
  slug: string | null;
  lines: CartLine[];
  note: string;
  /** Promo code the store accepted for these lines. */
  promo: AppliedPromo | null;
  /** The cart drawer is open (the store page renders it). */
  open: boolean;
};

const ACTIVE_KEY = "shop-cart-active";
const CONTACT_KEY = "shop-checkout-contact";
const storageKey = (slug: string) => `shop-cart-${slug}`;

const EMPTY: CartState = { slug: null, lines: [], note: "", promo: null, open: false };
let state: CartState = EMPTY;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked */
  }
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setState(next: Partial<CartState>) {
  state = { ...state, ...next };
  if (state.slug) write(storageKey(state.slug), { lines: state.lines, note: state.note, promo: state.promo });
  emit();
}

/** Hold the cart of store `slug` (read from localStorage). */
export function bindCart(slug: string) {
  if (state.slug === slug) return;
  const stored = parseStoredCart(read(storageKey(slug)));
  try {
    window.localStorage.setItem(ACTIVE_KEY, slug);
  } catch {
    /* ignore */
  }
  state = { ...state, slug, lines: stored.lines, note: stored.note, promo: stored.promo };
  emit();
}

/** Outside the store page: hold the cart of the last store opened. */
function bindLastActive() {
  if (state.slug || typeof window === "undefined") return;
  const slug = read(ACTIVE_KEY);
  if (slug) bindCart(slug);
}

/** Changing the lines drops the promo: the discount was quoted for the old cart. */
export function updateLines(update: (lines: CartLine[]) => CartLine[]) {
  setState({ lines: update(state.lines), promo: null });
}

export function setCartNote(note: string) {
  setState({ note });
}

export function setCartPromo(promo: AppliedPromo | null) {
  setState({ promo });
}

export function clearCart() {
  setState({ lines: [], note: "", promo: null, open: false });
}

/** Open the cart drawer; the store page reads it through useCart(). */
export function openCart() {
  setState({ open: true });
}

export function closeCart() {
  setState({ open: false });
}

export function getCartCount(): number {
  return cartCount(state.lines);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => state;
const getServerSnapshot = () => EMPTY;

export function useCart(): CartState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Item count of the active cart, for the site shell badge. */
export function useCartCount(): number {
  const cart = useCart();
  useEffect(bindLastActive, []);
  return cartCount(cart.lines);
}

/** Contact and shipping address remembered between checkouts. */
export type CheckoutContact = {
  name: string;
  phone: string;
  email: string;
  address: string;
  area: { id: string; label: string; postalCode: string | null } | null;
};

const EMPTY_CONTACT: CheckoutContact = { name: "", phone: "", email: "", address: "", area: null };

const text = (value: unknown) => (typeof value === "string" ? value : "");

export function readCheckoutContact(): CheckoutContact {
  try {
    const parsed: unknown = JSON.parse(read(CONTACT_KEY) ?? "null");
    if (typeof parsed !== "object" || parsed === null) return EMPTY_CONTACT;
    const stored = parsed as Partial<CheckoutContact>;
    const area = stored.area;
    return {
      name: text(stored.name),
      phone: text(stored.phone),
      email: text(stored.email),
      address: text(stored.address),
      area:
        area && typeof area.id === "string" && typeof area.label === "string"
          ? { id: area.id, label: area.label, postalCode: typeof area.postalCode === "string" ? area.postalCode : null }
          : null,
    };
  } catch {
    return EMPTY_CONTACT;
  }
}

export function saveCheckoutContact(contact: CheckoutContact) {
  write(CONTACT_KEY, contact);
}

/** Tests only: return the store to its initial state. */
export function resetCartStore() {
  state = EMPTY;
  emit();
}
