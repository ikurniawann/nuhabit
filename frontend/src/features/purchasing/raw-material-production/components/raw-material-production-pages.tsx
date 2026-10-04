"use client";

import {
  ProductionPage,
  ProductionRecipesPage,
  ProductionOrderDetailPage,
  RawMaterialBomEditorPage,
} from "../../production";

export function RawMaterialProductionPage() {
  return <ProductionPage moduleType="raw_material" />;
}

export function RawMaterialProductionRecipesPage() {
  return <ProductionRecipesPage moduleType="raw_material" />;
}

export function RawMaterialProductionOrderDetailPage() {
  return <ProductionOrderDetailPage moduleType="raw_material" />;
}

export function RawMaterialProductionBomEditorPage() {
  return <RawMaterialBomEditorPage />;
}
