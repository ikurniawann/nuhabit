"use client";

import { useQuery } from "@tanstack/react-query";
import { listPosTables } from "./api";
import { posTablesQueryKeys } from "./query-keys";

export function usePosTables(includeInactive = true) {
  return useQuery({
    queryKey: posTablesQueryKeys.list(includeInactive),
    queryFn: () => listPosTables(includeInactive),
  });
}
