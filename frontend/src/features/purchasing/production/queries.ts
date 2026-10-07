"use client";

import { useQuery } from "@tanstack/react-query";
import type { AdditionalCostReferenceType } from "@/lib/purchasing/cogs-additional-cost-ui";
import type { PurchasingModuleType } from "@/lib/purchasing/module-scope";
import {
  listAdditionalCosts,
  getProductionDashboard,
  getProductionCogs,
  listRecipeItems,
  getProductionOrder,
  getRawMaterialBomEditorData,
} from "./api";
import { productionQueryKeys } from "./query-keys";

function contextKey(moduleType: PurchasingModuleType) {
  return moduleType === "product" ? "product" : "raw_material";
}

export const useProductionDashboard = (moduleType: PurchasingModuleType = "raw_material") =>
  useQuery({
    queryKey: productionQueryKeys.dashboard(contextKey(moduleType)),
    queryFn: () => getProductionDashboard(moduleType),
    staleTime: 0,
  });

export const useProductionCogs = (moduleType: PurchasingModuleType, itemId: string) =>
  useQuery({
    queryKey: productionQueryKeys.cogs(contextKey(moduleType), itemId),
    queryFn: () => getProductionCogs(moduleType, itemId),
    enabled: !!itemId,
  });

export const useRecipeItems = (moduleType: PurchasingModuleType = "raw_material") =>
  useQuery({
    queryKey: productionQueryKeys.recipeItems(contextKey(moduleType)),
    queryFn: () => listRecipeItems(moduleType),
  });

export const useRawMaterialBomEditorData = (materialId: string) =>
  useQuery({
    queryKey: productionQueryKeys.rmBomEditorData(materialId),
    queryFn: () => getRawMaterialBomEditorData(materialId),
    enabled: !!materialId,
  });

export const useProductionOrder = (id: string) =>
  useQuery({
    queryKey: productionQueryKeys.order(id),
    queryFn: () => getProductionOrder(id),
    enabled: !!id,
  });

export const useAdditionalCosts = (referenceType?: AdditionalCostReferenceType) =>
  useQuery({
    queryKey: productionQueryKeys.additionalCosts(referenceType ?? "all"),
    queryFn: () => listAdditionalCosts(referenceType),
  });
