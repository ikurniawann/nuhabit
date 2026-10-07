"use client";

// Keranjang storefront publik sebagai store kecil di luar React, supaya
// shell situs (badge jumlah item, tombol buka keranjang) dan halaman toko
// berbagi satu sumber.
//
// localStorage:
//   `shop-cart-<slug>`  JSON { lines: CartLine[], note: string } per toko.
//                       Format lama (array CartLine) masih terbaca.
//   `shop-cart-active`  slug toko yang terakhir dibuka, supaya badge di luar
//                       halaman toko tetap tahu keranjang mana yang dihitung.

import { useEffect, useSyncExternalStore } from "react";
import { cartCount, parseStoredCart, type CartLine } from "@/lib/shop/storefront-cart";

export type CartState = {
  /** Slug toko yang keranjangnya sedang dipegang; null sebelum ada toko. */
  slug: string | null;
  lines: CartLine[];
  note: string;
  /** Drawer keranjang terbuka (halaman toko yang me-render-nya). */
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
      /* storage penuh / diblokir */
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

/** Pegang keranjang toko `slug` (dibaca dari localStorage). */
export function bindCart(slug: string) {
  if (state.slug === slug) return;
  const stored = parseStoredCart(read(storageKey(slug)));
  try {
    window.localStorage.setItem(ACTIVE_KEY, slug);
  } catch {
    /* abaikan */
  }
  state = { ...state, slug, lines: stored.lines, note: stored.note };
  emit();
}

/** Di luar halaman toko: pegang keranjang toko yang terakhir dibuka. */
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

/** Buka drawer keranjang; halaman toko membacanya lewat useCart(). */
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

/** Jumlah item di keranjang aktif, untuk badge di shell situs. */
export function useCartCount(): number {
  const cart = useCart();
  useEffect(bindLastActive, []);
  return cartCount(cart.lines);
}

/** Hanya untuk pengujian: kembalikan store ke keadaan awal. */
export function resetCartStore() {
  state = EMPTY;
  emit();
}
