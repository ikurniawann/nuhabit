declare global {
  interface Window {
    dataLayer?: Array<Record<string, unknown>>;
  }
}

/** Kirim event ke GTM bila dataLayer ada; tanpa GTM tidak terjadi apa pun. */
export function pushDataLayer(event: string, payload: Record<string, unknown> = {}) {
  if (typeof window === "undefined" || !Array.isArray(window.dataLayer)) return;
  window.dataLayer.push({ event, ...payload });
}
