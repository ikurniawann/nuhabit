"use client";

import { useSyncExternalStore } from "react";

const BRAND_PRIMARY_FALLBACK = "#00281a";
const noopSubscribe = () => () => {};

/** Warna --brand-primary dari tema aktif untuk grafik (fallback saat SSR / belum diset). */
export function useBrandPrimary(fallback = BRAND_PRIMARY_FALLBACK): string {
  return useSyncExternalStore(
    noopSubscribe,
    () => getComputedStyle(document.documentElement).getPropertyValue("--brand-primary").trim() || fallback,
    () => fallback
  );
}
