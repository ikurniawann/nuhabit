"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet, apiPost, apiPut } from "@/lib/api-client";
import type { CartLine } from "@/lib/shop/storefront-cart";
import { promoLines, type CheckoutPayload } from "@/lib/shop/storefront-checkout";
import {
  DEFAULT_STOREFRONT_SETTINGS,
  type AppliedPromo,
  type ProductReview,
  type PublicCatalog,
  type PublicOrderStatus,
  type ShopMember,
} from "@/lib/shop/types";
import type { AreaSuggestion } from "@/features/shop/shared/area-search";

export type RateQuote = {
  courierCode: string;
  courierName: string;
  serviceCode: string;
  serviceName: string;
  etd: string | null;
  total_price: number;
};

/** Store catalog; slug "default" loads the main store (/apparel). */
export const useStorefrontCatalog = (slug: string) =>
  useQuery({
    queryKey: ["shop", "storefront", slug],
    queryFn: () =>
      apiGet<{ data: PublicCatalog }>(`/api/public/shop/${slug}/catalog`).then(({ data }) => ({
        ...data,
        storefront: {
          ...data.storefront,
          settings: { ...DEFAULT_STOREFRONT_SETTINGS, ...data.storefront.settings },
          pickupBranches: data.storefront.pickupBranches ?? [],
          banner: data.storefront.banner ?? null,
        },
        products: data.products.map((product) => ({ ...product, relatedIds: product.relatedIds ?? [] })),
      })),
    retry: false,
  });

/** Published reviews of one product, newest first. */
export const useProductReviews = (slug: string, productId: string) =>
  useQuery({
    queryKey: ["shop", "reviews", slug, productId],
    queryFn: () =>
      apiGet<{ data: ProductReview[] }>(`/api/public/shop/${slug}/products/${productId}/reviews`).then((res) => res.data ?? []),
    staleTime: 60_000,
    retry: false,
  });

/** A member's review of a product from a paid order; it waits for moderation. */
export function submitProductReview(slug: string, body: { orderToken: string; productId: string; rating: number; comment: string | null }) {
  return apiPost<{ success: boolean }>(`/api/public/shop/${slug}/reviews`, body);
}

export function fetchWishlist(slug: string) {
  return apiGet<{ data: { productIds: string[] } | null }>(`/api/public/shop/${slug}/wishlist`).then(
    (res) => res.data?.productIds ?? []
  );
}

export function saveWishlist(slug: string, productIds: string[]) {
  return apiPut<{ success: boolean }>(`/api/public/shop/${slug}/wishlist`, { productIds });
}

/** The signed-in member (member_session cookie) or null for a guest. */
export const useShopMember = (slug: string, enabled: boolean) =>
  useQuery({
    queryKey: ["shop", "me", slug],
    queryFn: () => apiGet<{ data: ShopMember | null }>(`/api/public/shop/${slug}/me`).then((res) => res.data),
    enabled,
    staleTime: 60_000,
    retry: false,
  });

/** Public order status; polled every 5 s while pending, waiting for the paid webhook. */
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

/** Validate a promo code for these lines; a rejected code throws with the store's message. */
export function previewPromoCode(slug: string, code: string, cart: CartLine[]) {
  return apiPost<{ data: AppliedPromo }>(`/api/public/shop/${slug}/promo/preview`, {
    code: code.trim(),
    lines: promoLines(cart),
  }).then((res) => res.data);
}

/** Xendit answers with the invoice; ARK Coin pays at once and answers with the status page. */
export type CheckoutResponse =
  | { invoice_url: string }
  | { orderNumber: string; accessToken: string; status: "paid"; statusUrl: string };

export function submitShopCheckout(slug: string, payload: CheckoutPayload) {
  return apiPost<{ data: CheckoutResponse }>(`/api/public/shop/${slug}/checkout`, payload).then(
    (res) => res.data
  );
}
