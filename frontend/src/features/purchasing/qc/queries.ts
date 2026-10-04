"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { QCListParams } from "./types";
import { listQC, getQC } from "./api";
import { qcQueryKeys } from "./query-keys";

export const useQCList = (params: QCListParams) =>
  useQuery({
    queryKey: qcQueryKeys.list(params),
    queryFn: () => listQC(params),
    placeholderData: keepPreviousData,
  });

export const useQC = (id: string) =>
  useQuery({
    queryKey: qcQueryKeys.detail(id),
    queryFn: () => getQC(id),
    enabled: !!id,
    retry: false,
  });
