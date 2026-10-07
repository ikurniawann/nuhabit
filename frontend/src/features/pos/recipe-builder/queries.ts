"use client";

import { useQuery } from "@tanstack/react-query";
import { getProductBom, getRecipeCatalog } from "./api";
import { recipeBuilderQueryKeys } from "./query-keys";

export const useRecipeCatalog = () =>
  useQuery({
    queryKey: recipeBuilderQueryKeys.catalog(),
    queryFn: getRecipeCatalog,
  });

export const useProductBom = (productId: string) =>
  useQuery({
    queryKey: recipeBuilderQueryKeys.bom(productId),
    queryFn: () => getProductBom(productId),
    enabled: !!productId,
  });
