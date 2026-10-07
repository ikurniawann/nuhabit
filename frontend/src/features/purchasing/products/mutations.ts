"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  ProductFormData,
  BOMItemFormData,
} from "@/types/purchasing";
import {
  createProduct,
  updateProduct,
  applyProductRecipeHpp,
  updateProductStatus,
  deleteProduct,
  createBOMItem,
  updateBOMItem,
  deleteBOMItem,
} from "./api";
import { productsQueryKeys } from "./query-keys";
import { productionQueryKeys } from "@/features/purchasing/production/query-keys";

function invalidateProductAndProduction(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: productsQueryKeys.all });
  queryClient.invalidateQueries({ queryKey: productionQueryKeys.all });
}

export const useCreateProduct = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ProductFormData) => createProduct(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productsQueryKeys.all });
    },
  });
};

export const useUpdateProduct = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<ProductFormData> }) =>
      updateProduct(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productsQueryKeys.all });
    },
  });
};

export const useApplyProductRecipeHpp = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => applyProductRecipeHpp(id),
    onSuccess: () => {
      invalidateProductAndProduction(queryClient);
    },
  });
};

export const useUpdateProductStatus = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      updateProductStatus(id, isActive),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productsQueryKeys.all });
    },
  });
};

export const useDeleteProduct = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteProduct(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productsQueryKeys.all });
    },
  });
};

export const useCreateBOMItem = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, payload }: { productId: string; payload: BOMItemFormData }) =>
      createBOMItem(productId, payload),
    onSuccess: () => {
      invalidateProductAndProduction(queryClient);
    },
  });
};

export const useUpdateBOMItem = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<BOMItemFormData> }) =>
      updateBOMItem(id, payload),
    onSuccess: () => {
      invalidateProductAndProduction(queryClient);
    },
  });
};

export const useDeleteBOMItem = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteBOMItem(id),
    onSuccess: () => {
      invalidateProductAndProduction(queryClient);
    },
  });
};
