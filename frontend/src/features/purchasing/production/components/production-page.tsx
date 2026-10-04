"use client";

import { useState } from "react";
import Link from "next/link";
import { Beaker, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PurchasingPageHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import { useErrorToast } from "@/features/purchasing/reports/use-error-toast";
import type { PurchasingModuleType } from "@/lib/purchasing/module-scope";
import { hasRecipe, isActiveProductionStatus } from "@/lib/purchasing/production-ui-display";
import { useProductionOrderActions } from "../hooks/use-production-order-actions";
import { getProductionModuleConfig } from "../production-module";
import { useProductionDashboard } from "../queries";
import type { ProductionOrder, ProductionProduct } from "../types";
import { CreateProductionOrderDialog } from "./create-production-order-dialog";
import { ProductionItemsSection } from "./production-items-section";
import { ProductionOrdersSection } from "./production-orders-section";
import { ProductionWipSection } from "./production-wip-section";
import { ReceiveProductionDialog } from "./receive-production-dialog";

const HEADER_BUTTON =
  "h-10 w-full gap-2 rounded-lg border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 shadow-sm hover:border-pink-200 hover:bg-pink-50 hover:text-pink-700 sm:w-auto";

export function ProductionPage({ moduleType = "raw_material" }: { moduleType?: PurchasingModuleType }) {
  const config = getProductionModuleConfig(moduleType);
  const { isProduct } = config;

  const [orderPage, setOrderPage] = useState(1);
  const [formItem, setFormItem] = useState<ProductionProduct | null>(null);
  const [receiveOrder, setReceiveOrder] = useState<ProductionOrder | null>(null);

  const dashboardQuery = useProductionDashboard(moduleType);
  useErrorToast(dashboardQuery.error, "Gagal memuat data produksi");
  const orderActions = useProductionOrderActions();

  const orders = dashboardQuery.data?.orders ?? [];
  const items = dashboardQuery.data?.products ?? [];
  const wipSummary = dashboardQuery.data?.wipSummary ?? null;
  const loading = dashboardQuery.isLoading;
  const refreshing = dashboardQuery.isFetching && !dashboardQuery.isLoading;

  const readyItems = items.filter(hasRecipe).length;
  const activeOrders = orders.filter((order) => isActiveProductionStatus(order.status)).length;

  const handleRefresh = async () => {
    const result = await dashboardQuery.refetch();
    if (result.isError) toast.error(result.error.message || "Gagal memperbarui data produksi");
    else toast.success("Data produksi diperbarui");
  };

  const confirmReceive = async () => {
    if (receiveOrder && (await orderActions.receive(receiveOrder.id))) setReceiveOrder(null);
  };

  const stats = [
    { label: `Total ${isProduct ? "Produk" : "Bahan Baku"}`, value: items.length, tone: "gray" },
    { label: "Siap diproduksi", value: readyItems, tone: "emerald" },
    { label: "Order Aktif", value: activeOrders, tone: "pink" },
    { label: "WIP Siap untuk BOM", value: wipSummary?.ready_wip || 0, tone: "sky" },
  ] as const;

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title={isProduct ? "Produksi Internal" : "Produksi Bahan Baku"}
        description={
          <>
            {isProduct
              ? "Pilih produk untuk diproduksi, tinjau kelengkapan resep (BOM), dan buat order produksi"
              : "Pilih bahan baku untuk diproduksi internal, tinjau kelengkapan komponen, dan buat order produksi"}
            {" — "}
            {items.length} {isProduct ? "produk" : "bahan baku"}
          </>
        }
        actions={
          <>
            <Link href={config.productionRecipesRoute}>
              <Button variant="outline" className={HEADER_BUTTON}>
                <Beaker className="h-4 w-4" />
                Resep (BOM)
              </Button>
            </Link>
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleRefresh()}
              disabled={refreshing}
              className={HEADER_BUTTON}
            >
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Muat Ulang
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="border-gray-200/70 shadow-xs">
            <CardContent className="p-4">
              <p className={`text-xs font-medium uppercase tracking-wide ${STAT_TONES[stat.tone].label}`}>
                {stat.label}
              </p>
              <p className={`mt-1 text-2xl font-bold ${STAT_TONES[stat.tone].value}`}>{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <ProductionWipSection
        items={dashboardQuery.data?.wipInventory ?? []}
        summary={wipSummary}
        loading={loading}
        recipesRoute={config.productionRecipesRoute}
        stockCardRoute={config.stockCardRoute}
      />

      <ProductionItemsSection
        isProduct={isProduct}
        items={items}
        loading={loading}
        bomEditorRoute={config.bomEditorRoute}
        onCreateOrder={setFormItem}
      />

      <ProductionOrdersSection
        isProduct={isProduct}
        orders={orders}
        loading={loading}
        page={orderPage}
        onPageChange={setOrderPage}
        orderRoute={config.productionOrderRoute}
        pending={orderActions.pending}
        onAdvance={(orderId, action) => void orderActions.advance(orderId, action)}
        onReceive={setReceiveOrder}
      />

      <CreateProductionOrderDialog
        moduleType={moduleType}
        item={formItem}
        bomEditorHref={config.bomEditorRoute}
        onClose={() => setFormItem(null)}
        onCreated={() => {
          setFormItem(null);
          setOrderPage(1);
        }}
      />

      <ReceiveProductionDialog
        order={receiveOrder}
        loading={orderActions.pending?.type === "receive"}
        onClose={() => setReceiveOrder(null)}
        onConfirm={() => void confirmReceive()}
      />
    </div>
  );
}

const STAT_TONES = {
  gray: { label: "text-gray-500", value: "text-gray-900" },
  emerald: { label: "text-emerald-600", value: "text-emerald-700" },
  pink: { label: "text-pink-600", value: "text-pink-700" },
  sky: { label: "text-sky-600", value: "text-sky-700" },
};
