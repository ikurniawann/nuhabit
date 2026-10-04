"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteBomItem, saveRecipeItems } from "./api";
import { recipeBuilderQueryKeys } from "./query-keys";
import type { BomRow } from "./types";

export const useSaveRecipe = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, items }: { productId: string; items: BomRow[] }) =>
      saveRecipeItems(productId, items),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: recipeBuilderQueryKeys.bom(variables.productId) });
    },
  });
};

export const useDeleteBomItem = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; productId: string }) => deleteBomItem(id),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: recipeBuilderQueryKeys.bom(variables.productId) });
    },
  });
};
