"use client";

import {
  ProductionPage,
  ProductionRecipesPage,
  ProductionOrderDetailPage,
  ProductionWipPage,
  ProductionBatchesPage,
  ProductionBatchDetailPage,
} from "../../production";

export function ProductProductionPage() {
  return <ProductionPage moduleType="product" />;
}

export function ProductProductionRecipesPage() {
  return <ProductionRecipesPage moduleType="product" />;
}

export function ProductProductionOrderDetailPage() {
  return <ProductionOrderDetailPage moduleType="product" />;
}

export function ProductProductionWipPage() {
  return <ProductionWipPage moduleType="product" />;
}

export function ProductProductionBatchesPage() {
  return <ProductionBatchesPage moduleType="product" />;
}

export function ProductProductionBatchDetailPage() {
  return <ProductionBatchDetailPage moduleType="product" />;
}
