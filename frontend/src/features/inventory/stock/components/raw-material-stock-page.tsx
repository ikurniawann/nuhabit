"use client";

import { PurchasingPageHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import { RawMaterialStockTab } from "./raw-material-stock-tab";

export function RawMaterialStockPage() {
  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title="Stok Bahan Baku"
        description="Pantau saldo bahan baku dan nilai stok. Filter berdasarkan stall untuk melihat stok per lokasi penyimpanan."
      />
      <RawMaterialStockTab />
    </div>
  );
}
