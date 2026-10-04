"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { payOpenOrder } from "./api";
import { cashierQueryKeys } from "./query-keys";
import type { PayOpenOrderPayload } from "./api";

export const usePayOpenOrder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, payload }: { orderId: string; payload: PayOpenOrderPayload }) =>
      payOpenOrder(orderId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: cashierQueryKeys.all });
    },
  });
};
