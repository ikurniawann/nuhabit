// Storefront dataLayer events (GTM). Sent only when window.dataLayer exists
// (the site layout installs it when a GTM container id is set).

export type ShopEvent =
  | "view_item"
  | "add_to_cart"
  | "add_to_wishlist"
  | "select_promotion"
  | "buy_now"
  | "checkout_start"
  | "purchase";

export type ShopEventPayload = {
  shop: string;
  product: string;
  variant: string | null;
  qty: number;
  value: number;
  /** select_promotion only: the campaign code copied from the banner. */
  code?: string;
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
