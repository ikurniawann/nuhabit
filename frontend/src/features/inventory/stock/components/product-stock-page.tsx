"use client";

import { PurchasingPageHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import { ProductStockTab } from "./product-stock-tab";

export function ProductStockPage() {
  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title="Stok Produk"
        description="Pantau saldo produk jadi, nilai stok, dan ketersediaan per outlet."
      />
      <ProductStockTab />
    </div>
  );
}
