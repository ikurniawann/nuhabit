"use client";

import { useCallback, useSyncExternalStore } from "react";
import { CART_CHANGE_EVENT } from "@/features/shop/storefront-public/cart-store";
import { parseStoredCart } from "@/lib/shop/storefront-cart";

const CART_KEY_PREFIX = "shop-cart-";

/** Units across every storefront cart in localStorage (shop-cart-<slug>). */
export function readCartCount(storage: Pick<Storage, "length" | "key" | "getItem">): number {
  let total = 0;
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (!key?.startsWith(CART_KEY_PREFIX)) continue;
    for (const line of parseStoredCart(storage.getItem(key)).lines) total += line.quantity;
  }
  return total;
}

// "storage" covers other tabs, CART_CHANGE_EVENT this tab's storefront.
const EVENTS = ["storage", "focus", CART_CHANGE_EVENT] as const;

function subscribe(onChange: () => void) {
  for (const name of EVENTS) window.addEventListener(name, onChange);
  return () => {
    for (const name of EVENTS) window.removeEventListener(name, onChange);
  };
}

/** Live cart badge count; 0 on the server and when storage is blocked. */
export function useCartCount(): number {
  const read = useCallback(() => {
    try {
      return readCartCount(window.localStorage);
    } catch {
      return 0;
    }
  }, []);
  return useSyncExternalStore(subscribe, read, () => 0);
}
