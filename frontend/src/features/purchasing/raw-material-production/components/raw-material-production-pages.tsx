"use client";

import {
  ProductionPage,
  ProductionRecipesPage,
  ProductionOrderDetailPage,
  ProductionWipPage,
  ProductionBatchesPage,
  ProductionBatchDetailPage,
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

export function RawMaterialProductionWipPage() {
  return <ProductionWipPage moduleType="raw_material" />;
}

export function RawMaterialProductionBatchesPage() {
  return <ProductionBatchesPage moduleType="raw_material" />;
}

export function RawMaterialProductionBatchDetailPage() {
  return <ProductionBatchDetailPage moduleType="raw_material" />;
}
