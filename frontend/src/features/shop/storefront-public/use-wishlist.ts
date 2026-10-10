"use client";

import { useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { CatalogProduct, ShopMember } from "@/lib/shop/types";
import { pushShopEvent } from "./analytics";
import { fetchWishlist, saveWishlist } from "./queries";
import { adoptAccountWishlist, toggleWishlist, useSaved } from "./saved-store";

/**
 * The store's wishlist: localStorage for guests; for a signed-in member the
 * account list, merged with the guest list once, then kept in sync with PUT.
 */
export function useWishlist(slug: string | undefined, member: ShopMember | null | undefined) {
  const saved = useSaved();
  const signedIn = Boolean(slug) && Boolean(member);
  const account = useQuery({
    queryKey: ["shop", "wishlist", slug],
    queryFn: () => fetchWishlist(slug as string),
    enabled: signedIn,
    staleTime: Infinity,
    retry: false,
  });
  const save = useMutation({ mutationFn: (ids: string[]) => saveWishlist(slug as string, ids) });
  const { mutate: persist } = save;

  const accountIds = account.data;
  const ready = saved.slug === slug;
  useEffect(() => {
    if (!signedIn || !ready || saved.account || accountIds === undefined) return;
    const { ids, changed } = adoptAccountWishlist(accountIds);
    if (changed) persist(ids);
  }, [signedIn, ready, saved.account, accountIds, persist]);

  const toggle = (product: CatalogProduct) => {
    const ids = toggleWishlist(product.id);
    if (saved.account) persist(ids);
    if (ids.includes(product.id)) {
      pushShopEvent("add_to_wishlist", { shop: slug ?? "", product: product.name, variant: null, qty: 1, value: product.price });
    }
  };

  return { ids: saved.wishlist, has: (productId: string) => saved.wishlist.includes(productId), toggle };
}
