"use client";

import { useQuery } from "@tanstack/react-query";
import { portalRequest } from "@/lib/recruitment/portal-client";

export interface PortalOptions {
  outlets: { id: string; name: string }[];
  positions: { id: string; title: string; brand_id: string | null }[];
  opening: { brand_id: string | null; position_id: string | null } | null;
}

/**
 * Outlet, posisi, dan auto-fill job opening dari endpoint publik (portal
 * tanpa login). Gagal muat → dropdown kosong, form tetap bisa diisi.
 */
export function usePortalOptions(jobOpeningId: string | null) {
  return useQuery({
    queryKey: ["portal-options", jobOpeningId],
    queryFn: () =>
      portalRequest<{ data: PortalOptions }>(
        `/api/portal/options${jobOpeningId ? `?opening=${encodeURIComponent(jobOpeningId)}` : ""}`
      ).then((r) => r.data),
  });
}
