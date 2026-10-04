"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { listPrintJobs } from "./api";
import { printQueueQueryKeys } from "./query-keys";
import type { PrintJobListParams } from "./types";

export const usePrintJobs = (params: PrintJobListParams) =>
  useQuery({
    queryKey: printQueueQueryKeys.list(params),
    queryFn: () => listPrintJobs(params),
    placeholderData: keepPreviousData,
    refetchInterval: 5000,
  });
