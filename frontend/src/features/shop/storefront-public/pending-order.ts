import { clearCartIfMatches } from "./cart-store";

const key = (token: string) => `shop-pending-order-${token}`;
const latestKey = (slug: string) => `shop-pending-latest-${slug}`;

export function rememberPendingOrder(statusUrl: string, slug: string, signature: string) {
  try {
    const url = new URL(statusUrl, window.location.origin);
    const token = url.pathname.match(/\/shop\/order\/([^/]+)\/?$/)?.[1];
    if (token) {
      window.localStorage.setItem(key(token), JSON.stringify({ slug, signature }));
      window.localStorage.setItem(latestKey(slug), JSON.stringify({ token, statusUrl: url.href }));
    }
  } catch {
    // Checkout still proceeds when browser storage is unavailable.
  }
}

export function latestPendingOrder(slug: string): string | null {
  try {
    const stored = JSON.parse(window.localStorage.getItem(latestKey(slug)) ?? "null") as { statusUrl?: string } | null;
    return stored?.statusUrl ?? null;
  } catch { return null; }
}

export function settlePendingOrder(token: string, status: string) {
  if (status === "pending") return;
  try {
    const raw = window.localStorage.getItem(key(token));
    if (!raw) return;
    const data = JSON.parse(raw) as { slug?: string; signature?: string };
    if (["paid", "packing", "shipped", "completed", "ready_for_pickup", "picked_up"].includes(status)
      && data.slug && data.signature) clearCartIfMatches(data.slug, data.signature);
    if (data.slug) {
      const latest = JSON.parse(window.localStorage.getItem(latestKey(data.slug)) ?? "null") as { token?: string } | null;
      if (latest?.token === token) window.localStorage.removeItem(latestKey(data.slug));
    }
    window.localStorage.removeItem(key(token));
  } catch {
    // Keep the order status page usable when storage is unavailable.
  }
}
