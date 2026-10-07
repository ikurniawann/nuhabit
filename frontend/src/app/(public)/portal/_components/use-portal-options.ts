"use client";

import { useQuery } from "@tanstack/react-query";
import { portalRequest } from "@/lib/recruitment/portal-client";

export interface PortalOptions {
  outlets: { id: string; name: string }[];
  positions: { id: string; title: string; brand_id: string | null }[];
  opening: { brand_id: string | null; position_id: string | null } | null;
}

/**
 * Outlets, positions and the job-opening auto-fill from the public endpoint
 * (no login). A failed load leaves the dropdowns empty; the form still works.
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
