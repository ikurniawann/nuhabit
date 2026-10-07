"use client";

import { useQuery } from "@tanstack/react-query";
import type { FunnelReport, ReportFilters } from "./types";

async function fetchReport(filters: ReportFilters): Promise<FunnelReport> {
  const params = new URLSearchParams();
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  const res = await fetch(`/api/sales-funnel/reports?${params.toString()}`);
  if (!res.ok) {
    let message = "Gagal memuat laporan";
    try {
      const body = (await res.json()) as { error?: string };
      message = body.error ?? message;
    } catch {
      // bukan JSON — pakai fallback
    }
    throw new Error(message);
  }
  const body = (await res.json()) as { data: FunnelReport };
  return body.data;
}

export const useFunnelReport = (filters: ReportFilters) =>
  useQuery({
    queryKey: ["sales-funnel", "reports", filters] as const,
    queryFn: () => fetchReport(filters),
  });
