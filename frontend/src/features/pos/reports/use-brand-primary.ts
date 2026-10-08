"use client";

import { useSyncExternalStore } from "react";

const BRAND_PRIMARY_FALLBACK = "#00281a";
const noopSubscribe = () => () => {};

/** Deep Forest Green untuk grafik pada permukaan terang. */
export function useBrandPrimary(fallback = BRAND_PRIMARY_FALLBACK): string {
  return useSyncExternalStore(
    noopSubscribe,
    () => getComputedStyle(document.documentElement).getPropertyValue("--brand-secondary").trim() || fallback,
    () => fallback
  );
}
