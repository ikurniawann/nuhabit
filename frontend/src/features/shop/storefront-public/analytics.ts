// Storefront dataLayer events (GTM). Sent only when window.dataLayer exists
// (the site layout installs it when a GTM container id is set).

export type ShopEvent = "add_to_cart" | "buy_now" | "checkout_start" | "purchase";

export type ShopEventPayload = {
  shop: string;
  product: string;
  variant: string | null;
  qty: number;
  value: number;
  /** purchase only */
  order?: string;
  payment?: string;
  delivery?: string;
};

type DataLayerWindow = Window & { dataLayer?: Array<Record<string, unknown>> };

export function pushShopEvent(event: ShopEvent, payload: ShopEventPayload) {
  if (typeof window === "undefined") return;
  const layer = (window as DataLayerWindow).dataLayer;
  if (!Array.isArray(layer)) return;
  layer.push({ event, ...payload });
}
