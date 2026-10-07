declare global {
  interface Window {
    dataLayer?: Array<Record<string, unknown>>;
  }
}

/** Pushes an event to GTM when dataLayer exists; without GTM nothing happens. */
export function pushDataLayer(event: string, payload: Record<string, unknown> = {}) {
  if (typeof window === "undefined" || !Array.isArray(window.dataLayer)) return;
  window.dataLayer.push({ event, ...payload });
}
