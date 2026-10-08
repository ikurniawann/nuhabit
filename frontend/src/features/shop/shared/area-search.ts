"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";

/** Area/kecamatan tujuan dari provider kurir (admin & storefront publik). */
export type AreaSuggestion = { id: string; label: string; postalCode: string | null };

const MIN_QUERY = 3;

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timeout);
  }, [value, delayMs]);
  return debounced;
}

/**
 * Autocomplete area: query di-debounce 400 ms, minimal 3 huruf. `endpoint`
 * menerima `?q=`; `enabled=false` (mis. area sudah dipilih) mengosongkan saran.
 */
export function useAreaSearch(endpoint: string, query: string, enabled = true) {
  const trimmed = query.trim();
  const debounced = useDebouncedValue(trimmed, 400);
  const active = enabled && trimmed.length >= MIN_QUERY && debounced === trimmed;

  const result = useQuery({
    queryKey: ["shop", "areas", endpoint, debounced],
    queryFn: () =>
      apiGet<{ data: AreaSuggestion[] }>(`${endpoint}?q=${encodeURIComponent(debounced)}`).then(
        (res) => res.data ?? []
      ),
    enabled: active,
    staleTime: 60_000,
    retry: false,
  });

  return {
    areas: active ? (result.data ?? []) : [],
    searching: enabled && trimmed.length >= MIN_QUERY && (!active || result.isFetching),
    searched: active && result.isSuccess && !result.isFetching,
    error: active ? result.error : null,
  };
}
