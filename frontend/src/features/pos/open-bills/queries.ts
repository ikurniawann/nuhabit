"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { listOpenBills } from "./api";
import { openBillsQueryKeys } from "./query-keys";
import type { OpenBillsListParams } from "./types";

export const useOpenBills = (params: OpenBillsListParams = { limit: 200 }) =>
  useQuery({
    queryKey: openBillsQueryKeys.list(params),
    queryFn: () => listOpenBills(params),
    placeholderData: keepPreviousData,
    refetchInterval: 5000,
  });
