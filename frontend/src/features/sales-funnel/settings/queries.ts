"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchRecipe, saveRecipe, searchRawMaterials, type RecipeItemPayload } from "./api";

export const settingsQueryKeys = {
  recipes: ["sales-funnel", "recipes"] as const,
  recipe: (productId: string) => ["sales-funnel", "recipes", productId] as const,
  rawMaterials: (q: string) => ["sales-funnel", "raw-materials", q] as const,
};

export const useRecipe = (productId: string) =>
  useQuery({
    queryKey: settingsQueryKeys.recipe(productId),
    queryFn: () => fetchRecipe(productId),
    enabled: productId !== "",
  });

/** Pencarian bahan baku (min. 2 huruf, sama dengan batas server). */
export const useRawMaterialSearch = (q: string) =>
  useQuery({
    queryKey: settingsQueryKeys.rawMaterials(q),
    queryFn: () => searchRawMaterials(q),
    enabled: q.length >= 2,
  });

export function useSaveRecipe(productId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (items: RecipeItemPayload[]) => saveRecipe(productId, items),
    onSuccess: () => {
      toast.success("Resep disimpan");
      queryClient.invalidateQueries({ queryKey: settingsQueryKeys.recipes });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}
