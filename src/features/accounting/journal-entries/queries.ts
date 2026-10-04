"use client";

import { useQuery } from "@tanstack/react-query";
import { journalEntryQueryKeys } from "./query-keys";
import { fetchJournalEntryList, fetchJournalEntry } from "./api";
import type { JournalEntryListFilters } from "@/lib/accounting/types";

export const useJournalEntryList = (filters?: JournalEntryListFilters) =>
  useQuery({
    queryKey: journalEntryQueryKeys.list(
      filters as Record<string, string | undefined>
    ),
    queryFn: () => fetchJournalEntryList(filters),
  });

export const useJournalEntry = (id: string | null) =>
  useQuery({
    queryKey: journalEntryQueryKeys.detail(id ?? ""),
    queryFn: () => fetchJournalEntry(id!),
    enabled: Boolean(id),
  });
