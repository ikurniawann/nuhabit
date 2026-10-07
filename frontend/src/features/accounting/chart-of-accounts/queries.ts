"use client";

import { useQuery } from "@tanstack/react-query";
import { coaQueryKeys } from "./query-keys";
import { fetchCoaList } from "./api";
import type { CoaListFilters } from "./types";

export const useCoaList = (filters?: CoaListFilters) =>
  useQuery({
    queryKey: coaQueryKeys.list(filters as Record<string, string | undefined>),
    queryFn: () => fetchCoaList(filters),
  });
