"use client";

import { useQuery } from "@tanstack/react-query";
import { journalMappingQueryKeys } from "./query-keys";
import { fetchJournalMappingList, fetchJournalMapping } from "./api";
import type { JournalMappingListFilters } from "@/lib/accounting/types";

export const useJournalMappingList = (filters?: JournalMappingListFilters) =>
  useQuery({
    queryKey: journalMappingQueryKeys.list(
      filters as Record<string, string | undefined>
    ),
    queryFn: () => fetchJournalMappingList(filters),
  });

export const useJournalMapping = (id: string | null) =>
  useQuery({
    queryKey: journalMappingQueryKeys.detail(id ?? ""),
    queryFn: () => fetchJournalMapping(id!),
    enabled: Boolean(id),
  });
