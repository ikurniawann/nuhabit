"use client";

import { useQuery } from "@tanstack/react-query";
import type { AdditionalCostReferenceType } from "@/lib/purchasing/cogs-additional-cost-ui";
import type { PurchasingModuleType } from "@/features/purchasing/module-type";
import { recipeOwnerId, type RecipeOwner } from "@/lib/purchasing/production-recipe-settings";
import {
  listAdditionalCosts,
  getProductionDashboard,
  getProductionCogs,
  listRecipeItems,
  getProductionOrder,
  getRawMaterialBomEditorData,
  getProductionFlow,
  getProductionWip,
  listProductionBatches,
  getProductionBatch,
  getRecipeSettings,
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

export const useProductionFlow = (orderId: string) =>
  useQuery({
    queryKey: productionQueryKeys.flow(orderId),
    queryFn: () => getProductionFlow(orderId),
    enabled: !!orderId,
  });

export const useProductionWip = (moduleType: PurchasingModuleType, search: string) =>
  useQuery({
    queryKey: productionQueryKeys.wip(contextKey(moduleType), search),
    queryFn: () => getProductionWip(contextKey(moduleType), search),
  });

export const useProductionBatches = (moduleType: PurchasingModuleType, search: string) =>
  useQuery({
    queryKey: productionQueryKeys.batches(contextKey(moduleType), search),
    queryFn: () => listProductionBatches(contextKey(moduleType), search),
  });

export const useProductionBatch = (id: string) =>
  useQuery({
    queryKey: productionQueryKeys.batch(id),
    queryFn: () => getProductionBatch(id),
    enabled: !!id,
  });

export const useAdditionalCosts = (referenceType?: AdditionalCostReferenceType) =>
  useQuery({
    queryKey: productionQueryKeys.additionalCosts(referenceType ?? "all"),
    queryFn: () => listAdditionalCosts(referenceType),
  });

export const useRecipeSettings = (owner: RecipeOwner) =>
  useQuery({
    queryKey: productionQueryKeys.recipeSettings(recipeOwnerId(owner)),
    queryFn: () => getRecipeSettings(owner),
    enabled: !!recipeOwnerId(owner),
  });
