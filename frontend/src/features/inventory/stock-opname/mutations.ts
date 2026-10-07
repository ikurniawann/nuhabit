"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateStockOpnameInput, UpdateStockOpnameInput } from "./types";
import {
  completeStockOpname,
  createStockOpname,
  updateStockOpname,
} from "./api";
import { stockOpnameQueryKeys } from "./query-keys";

export const useCreateStockOpname = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateStockOpnameInput) => createStockOpname(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: stockOpnameQueryKeys.all });
    },
  });
};

export const useUpdateStockOpname = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: UpdateStockOpnameInput;
    }) => updateStockOpname(id, input),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: stockOpnameQueryKeys.all });
      queryClient.invalidateQueries({
        queryKey: stockOpnameQueryKeys.detail(variables.id),
      });
    },
  });
};

export const useCompleteStockOpname = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => completeStockOpname(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: stockOpnameQueryKeys.all });
      queryClient.invalidateQueries({
        queryKey: stockOpnameQueryKeys.detail(id),
      });
    },
  });
};
