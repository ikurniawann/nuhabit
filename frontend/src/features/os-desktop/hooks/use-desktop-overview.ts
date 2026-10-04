"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { DesktopOverview } from "@/lib/desktop/overview";
import type { PeriodKind } from "@/lib/desktop/period";

export interface OverviewState {
  status: "loading" | "ready" | "forbidden" | "error";
  data: DesktopOverview | null;
}

const REFRESH_MS = 60_000; // keputusan owner: 60 detik

type OverviewResult = { forbidden: true } | { forbidden: false; overview: DesktopOverview };

async function fetchOverview(periode: PeriodKind): Promise<OverviewResult> {
  const res = await fetch(`/api/desktop/overview?periode=${periode}`);
  if (res.status === 401 || res.status === 403) return { forbidden: true };
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "gagal");
  return { forbidden: false, overview: json.data as DesktopOverview };
}

/**
 * Overview papan monitoring, auto-refresh 60 dtk (berhenti saat tab
 * tersembunyi, menyusul begitu tab terlihat lagi). 401/403 → `forbidden`:
 * papan tidak dirender dan polling berhenti total. Gagal jaringan sementara
 * mempertahankan data terakhir. `onSnapshot` menerima setiap snapshot baru
 * (dipakai notifikasi aktivitas).
 */
export function useDesktopOverview(
  enabled: boolean,
  periode: PeriodKind,
  onSnapshot: (overview: DesktopOverview) => void
): OverviewState {
  const query = useQuery({
    queryKey: ["os-desktop", "overview", periode],
    queryFn: async () => {
      const result = await fetchOverview(periode);
      if (!result.forbidden) onSnapshot(result.overview);
      return result;
    },
    enabled,
    staleTime: REFRESH_MS,
    retry: false,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: true,
    refetchInterval: (q) => (q.state.data?.forbidden ? false : REFRESH_MS),
  });

  const result = query.data;
  if (result?.forbidden) return { status: "forbidden", data: null };
  if (result) return { status: "ready", data: result.overview };
  return { status: query.isError ? "error" : "loading", data: null };
}
