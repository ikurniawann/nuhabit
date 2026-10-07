// Event dataLayer storefront (GTM). Dikirim hanya bila window.dataLayer ada
// (layout situs memasangnya saat GTM container id diisi).

export type ShopEvent = "add_to_cart" | "buy_now" | "checkout_start";

export type ShopEventPayload = {
  shop: string;
  product: string;
  variant: string | null;
  qty: number;
  value: number;
};

type DataLayerWindow = Window & { dataLayer?: Array<Record<string, unknown>> };

export function pushShopEvent(event: ShopEvent, payload: ShopEventPayload) {
  if (typeof window === "undefined") return;
  const layer = (window as DataLayerWindow).dataLayer;
  if (!Array.isArray(layer)) return;
  layer.push({ event, ...payload });
}
