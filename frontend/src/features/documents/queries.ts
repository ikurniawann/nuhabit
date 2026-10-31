"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchLetterhead } from "./api";

export const letterheadQueryKeys = {
  all: ["settings", "letterhead"] as const,
  company: (companyId?: string | null) => [...letterheadQueryKeys.all, companyId ?? ""] as const,
};

/**
 * Kop perusahaan untuk quotation dan invoice; per perusahaan bila ada
 * konteksnya. `enabled` false menunggu konteks itu dimuat, supaya kop
 * global tidak sempat tampil lalu berganti.
 */
export const useLetterhead = (companyId?: string | null, enabled = true) =>
  useQuery({
    queryKey: letterheadQueryKeys.company(companyId),
    queryFn: () => fetchLetterhead(companyId),
    staleTime: 5 * 60 * 1000,
    enabled,
  });
