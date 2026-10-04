"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CreateProductStockOpnameInput,
  UpdateProductStockOpnameInput,
} from "./types";
import {
  completeProductStockOpname,
  createProductStockOpname,
  updateProductStockOpname,
} from "./api";
import { productStockOpnameQueryKeys } from "./query-keys";

export const useCreateProductStockOpname = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProductStockOpnameInput) =>
      createProductStockOpname(input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: productStockOpnameQueryKeys.all,
      });
    },
  });
};

export const useUpdateProductStockOpname = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: UpdateProductStockOpnameInput;
    }) => updateProductStockOpname(id, input),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: productStockOpnameQueryKeys.all,
      });
      queryClient.invalidateQueries({
        queryKey: productStockOpnameQueryKeys.detail(variables.id),
      });
    },
  });
};

export const useCompleteProductStockOpname = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => completeProductStockOpname(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({
        queryKey: productStockOpnameQueryKeys.all,
      });
      queryClient.invalidateQueries({
        queryKey: productStockOpnameQueryKeys.detail(id),
      });
    },
  });
};
