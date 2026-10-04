"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { generalPoQueryKeys } from "../general-po/query-keys";
import { grnQueryKeys } from "../grn/query-keys";
import { createGeneralGrn, listReceivableGeneralPOs, type CreateGeneralGrnPayload } from "./api";

export const useReceivableGeneralPOs = (search: string) =>
  useQuery({
    queryKey: ["purchasing", "general-receive", "receivable-pos", search] as const,
    queryFn: () => listReceivableGeneralPOs(search || undefined),
    placeholderData: keepPreviousData,
  });

export const useCreateGeneralGrn = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateGeneralGrnPayload) => createGeneralGrn(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchasing", "general-receive"] });
      queryClient.invalidateQueries({ queryKey: generalPoQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: grnQueryKeys.all });
    },
  });
};
