"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { saveOrderSplits } from "./api";
import { openBillsQueryKeys } from "./query-keys";

export const useCreateOrderSplits = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      orderId,
      payload,
    }: {
      orderId: string;
      payload: Parameters<typeof saveOrderSplits>[1];
    }) => saveOrderSplits(orderId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: openBillsQueryKeys.all });
    },
  });
};
