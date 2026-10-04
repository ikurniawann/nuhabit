"use client";

import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { isSearchable } from "@/lib/desktop/search";

export type SearchGroup = {
  source: string;
  label: string;
  items: Array<{ id: string; title: string; subtitle?: string | null; href: string }>;
};

const DEBOUNCE_MS = 220;

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/**
 * Spotlight juga mencari DATA (transaksi, member, produk, karyawan, dokumen)
 * lewat /api/desktop/search, dibatasi menu IAM pengguna. Diketik cepat →
 * hanya kueri terakhir yang dikirim; kueri lama dibatalkan.
 */
export function useSpotlightSearch(query: string, isLoggedIn: boolean) {
  const term = useDebouncedValue(query.trim(), DEBOUNCE_MS);
  const enabled = isLoggedIn && isSearchable(term);
  const result = useQuery({
    queryKey: ["os-desktop", "search", term],
    queryFn: async ({ signal }): Promise<SearchGroup[]> => {
      const res = await fetch(`/api/desktop/search?q=${encodeURIComponent(term)}`, { signal });
      const json = res.ok ? await res.json() : null;
      return Array.isArray(json?.data?.groups) ? json.data.groups : [];
    },
    enabled,
    placeholderData: keepPreviousData,
    retry: false,
  });
  return { hits: enabled ? (result.data ?? []) : [], searching: enabled && result.isFetching };
}
