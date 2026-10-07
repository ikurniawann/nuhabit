"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { saveXpRule } from "./api";
import { xpRulesQueryKeys } from "./query-keys";

export const useSaveXpRule = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveXpRule,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: xpRulesQueryKeys.all });
    },
  });
};
