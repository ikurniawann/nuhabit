"use client";

// The public storefront cart as a small store outside React, so the site
// shell (item count badge, open-cart button) and the store page share one
// source.
//
// localStorage:
//   `shop-cart-<slug>`  JSON { lines: CartLine[], note: string } per store.
//                       The old format (an array of CartLine) still reads.
//   `shop-cart-active`  slug of the last store opened, so the badge outside
//                       the store page knows which cart to count.

import { useEffect, useSyncExternalStore } from "react";
import { cartCount, parseStoredCart, type CartLine } from "@/lib/shop/storefront-cart";

export type CartState = {
  /** Slug of the store whose cart is held; null before any store loads. */
  slug: string | null;
  lines: CartLine[];
  note: string;
  /** The cart drawer is open (the store page renders it). */
  open: boolean;
};

const ACTIVE_KEY = "shop-cart-active";
const storageKey = (slug: string) => `shop-cart-${slug}`;

const EMPTY: CartState = { slug: null, lines: [], note: "", open: false };
let state: CartState = EMPTY;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function setState(next: Partial<CartState>) {
  state = { ...state, ...next };
  if (state.slug) {
    try {
      window.localStorage.setItem(storageKey(state.slug), JSON.stringify({ lines: state.lines, note: state.note }));
    } catch {
      /* storage full or blocked */
    }
  }
  emit();
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
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
  state = { ...state, slug, lines: stored.lines, note: stored.note };
  emit();
}

/** Outside the store page: hold the cart of the last store opened. */
function bindLastActive() {
  if (state.slug || typeof window === "undefined") return;
  const slug = read(ACTIVE_KEY);
  if (slug) bindCart(slug);
}

export function updateLines(update: (lines: CartLine[]) => CartLine[]) {
  setState({ lines: update(state.lines) });
}

export function setCartNote(note: string) {
  setState({ note });
}

export function clearCart() {
  setState({ lines: [], note: "", open: false });
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

/** Tests only: return the store to its initial state. */
export function resetCartStore() {
  state = EMPTY;
  emit();
}
