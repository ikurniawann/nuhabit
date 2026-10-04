"use client";

import {
  ProductionPage,
  ProductionRecipesPage,
  ProductionOrderDetailPage,
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
