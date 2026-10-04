"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api-client";
import { parseStoredCart, type CartLine } from "@/lib/shop/storefront-cart";
import type { CatalogProduct, PublicOrderStatus, PublicStorefront } from "@/lib/shop/types";
import type { AreaSuggestion } from "@/features/shop/shared/area-search";

export type RateQuote = {
  courierCode: string;
  courierName: string;
  serviceCode: string;
  serviceName: string;
  etd: string | null;
  total_price: number;
};

export const useStorefrontCatalog = (slug: string) =>
  useQuery({
    queryKey: ["shop", "storefront", slug],
    queryFn: () =>
      apiGet<{ data: { storefront: PublicStorefront; products: CatalogProduct[] } }>(
        `/api/public/shop/${slug}/catalog`
      ).then((res) => res.data),
    retry: false,
  });

/** Status order publik; selama masih pending di-poll tiap 5 dtk menunggu webhook paid. */
export const useShopOrderStatus = (token: string) =>
  useQuery({
    queryKey: ["shop", "order-status", token],
    queryFn: () =>
      apiGet<{ data: PublicOrderStatus }>(`/api/public/shop/order/${token}`).then((res) => res.data),
    refetchInterval: (query) => (query.state.data?.status === "pending" ? 5000 : false),
    retry: false,
  });

export function fetchShippingRates(slug: string, area: AreaSuggestion, cart: CartLine[]) {
  return apiPost<{ data: RateQuote[] }>(`/api/public/shop/${slug}/shipping/rates`, {
    destination_id: area.id,
    destination_postal_code: area.postalCode,
    items: cart.map((line) => ({ product_id: line.productId, quantity: line.quantity })),
  }).then((res) => res.data ?? []);
}

export type CheckoutPayload = {
  items: Array<{ product_id: string; sku_id: string | null; quantity: number }>;
  customer: { name: string; phone: string; email: string | null };
  destination: { area_id: string; label: string; postal_code: string | null; address: string };
  courier: { code: string; service_code: string };
  notes: string | null;
};

export function submitShopCheckout(slug: string, payload: CheckoutPayload) {
  return apiPost<{ data: { invoice_url: string } }>(`/api/public/shop/${slug}/checkout`, payload).then(
    (res) => res.data
  );
}

/**
 * Keranjang per slug di localStorage. Dibaca saat state dibuat (render server
 * selalu kosong; keranjang baru tampil setelah katalog dimuat di klien).
 */
export function useStoredCart(slug: string) {
  const storageKey = `shop-cart-${slug}`;
  const [cart, setCart] = useState<CartLine[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      return parseStoredCart(window.localStorage.getItem(storageKey));
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(cart));
    } catch {
      /* storage penuh / diblokir — abaikan */
    }
  }, [cart, storageKey]);

  return [cart, setCart] as const;
}
