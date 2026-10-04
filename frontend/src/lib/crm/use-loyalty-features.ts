"use client";

import { useQuery } from "@tanstack/react-query";
import { DEFAULT_LOYALTY_FEATURES, type LoyaltyFeatures } from "./loyalty-features";

async function fetchLoyaltyFeatures(): Promise<LoyaltyFeatures> {
  const res = await fetch("/api/crm/loyalty-features", { cache: "no-store" });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) throw new Error(json?.error || "Gagal memuat fitur loyalty");
  return json.data as LoyaltyFeatures;
}

/**
 * Flag ARK Coin & XP untuk UI klien (kasir, dsb.). Selama memuat / bila gagal
 * dianggap AKTIF — sama dengan default server, jadi instance yang tidak
 * menyentuh saklar ini tidak berubah perilakunya.
 */
export function useLoyaltyFeatures(): LoyaltyFeatures {
  const { data } = useQuery({
    queryKey: ["crm", "loyalty-features"],
    queryFn: fetchLoyaltyFeatures,
    staleTime: 60_000,
    retry: 1,
  });
  return data ?? DEFAULT_LOYALTY_FEATURES;
}
