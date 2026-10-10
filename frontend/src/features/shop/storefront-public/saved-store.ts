"use client";

// Wishlist and recently viewed product ids per store, held outside React so
// the page, the cards and the product sheet share one list.
//
// localStorage (keys also listed in cart-store.ts):
//   `shop-wishlist-<slug>`  JSON string[]: ids a guest saved. A signed-in member's
//                           list lives on the account (GET/PUT .../wishlist); the
//                           guest list merges into it once and is then removed.
//   `shop-recent-<slug>`    JSON string[]: ids viewed, newest first, at most 8.

import { useSyncExternalStore } from "react";
import { mergeWishlist, parseIdList, pushRecentlyViewed, sameIds, toggleSaved } from "@/lib/shop/storefront-saved";

export type SavedState = {
  slug: string | null;
  wishlist: string[];
  recent: string[];
  /** The wishlist is the member's account list (kept in sync through PUT). */
  account: boolean;
};

const wishlistKey = (slug: string) => `shop-wishlist-${slug}`;
const recentKey = (slug: string) => `shop-recent-${slug}`;

const EMPTY: SavedState = { slug: null, wishlist: [], recent: [], account: false };
let state: SavedState = EMPTY;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function read(key: string): string[] {
  try {
    return parseIdList(window.localStorage.getItem(key));
  } catch {
    return [];
  }
}

function write(key: string, ids: string[] | null) {
  try {
    if (ids === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    /* storage full or blocked */
  }
}

/** Hold the lists of store `slug` (read from localStorage). */
export function bindSaved(slug: string) {
  if (state.slug === slug) return;
  state = { slug, wishlist: read(wishlistKey(slug)), recent: read(recentKey(slug)), account: false };
  emit();
}

/** Save or unsave a product; returns the new list. Guests keep it in localStorage. */
export function toggleWishlist(productId: string): string[] {
  const wishlist = toggleSaved(state.wishlist, productId);
  state = { ...state, wishlist };
  if (state.slug && !state.account) write(wishlistKey(state.slug), wishlist);
  emit();
  return wishlist;
}

/**
 * Switch to the member's account list, merged with the guest list once.
 * Returns the merged list and whether it differs from the account's.
 */
export function adoptAccountWishlist(accountIds: string[]): { ids: string[]; changed: boolean } {
  const ids = mergeWishlist(accountIds, state.wishlist);
  state = { ...state, wishlist: ids, account: true };
  if (state.slug) write(wishlistKey(state.slug), null);
  emit();
  return { ids, changed: !sameIds(ids, accountIds) };
}

export function pushRecent(productId: string) {
  const recent = pushRecentlyViewed(state.recent, productId);
  state = { ...state, recent };
  if (state.slug) write(recentKey(state.slug), recent);
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => state;
const getServerSnapshot = () => EMPTY;

export function useSaved(): SavedState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Tests only: return the store to its initial state. */
export function resetSavedStore() {
  state = EMPTY;
  emit();
}
