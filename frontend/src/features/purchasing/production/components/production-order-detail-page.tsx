"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2, PackageCheck, Play, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PurchasingFormHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import { useErrorToast } from "@/features/purchasing/reports/use-error-toast";
import { formatDate } from "@/lib/format";
import type { PurchasingModuleType } from "@/lib/purchasing/module-scope";
import {
  displayName,
  isActiveProductionStatus,
  productionStatusClass,
  productionStatusLabel,
  shortagePoHref,
  toNumber,
} from "@/lib/purchasing/production-ui-display";
import type { ProductionOrderAction } from "@/lib/purchasing/production-ui-types";
import { useUpdateProductionOrder } from "../mutations";
import { getProductionModuleConfig } from "../production-module";
import { useProductionOrder } from "../queries";
import { CompleteProductionDialog } from "./complete-production-dialog";
import { ProductionOrderCostAndBatches, ProductionOrderStats } from "./production-order-cost-cards";
import { ORDER_ACTION_BUTTON, ProductionOrderMaterialsCard } from "./production-order-materials-card";

const MAIN_ACTION = "purchasing-main-button w-full gap-2 sm:w-auto";
const SECONDARY_ACTION = "purchasing-secondary-button w-full gap-2 sm:w-auto";
const DESTRUCTIVE_ACTION =
  "h-10 w-full gap-2 rounded-lg border-red-200/80 bg-white px-3 text-sm font-medium text-red-600 shadow-sm hover:border-red-200 hover:bg-red-50 hover:text-red-700 sm:w-auto";

export function ProductionOrderDetailPage({ moduleType = "raw_material" }: { moduleType?: PurchasingModuleType }) {
  const config = getProductionModuleConfig(moduleType);
  const orderId = useParams<{ id: string }>().id;
  const [completeOpen, setCompleteOpen] = useState(false);

  const orderQuery = useProductionOrder(orderId);
  useErrorToast(orderQuery.error, "Gagal memuat detail order produksi");
  const actionMutation = useUpdateProductionOrder();
  const order = orderQuery.data ?? null;
  const loading = orderQuery.isLoading || orderQuery.isFetching || actionMutation.isPending;

  const runAction = async (action: ProductionOrderAction, payload: Record<string, unknown> = {}) => {
    try {
      const message = await actionMutation.mutateAsync({ id: orderId, payload: { action, ...payload } });
      toast.success(
        message || (action === "complete" ? "Output produksi diterima ke inventori" : "Order produksi diperbarui")
      );
      return true;
    } catch (error) {
      const fallback = action === "complete" ? "Gagal menerima output produksi" : "Gagal memperbarui order produksi";
      toast.error(error instanceof Error ? error.message : fallback);
      // Cek ulang stok tetap memuat ulang supaya angka kekurangan terbaru tampil.
      if (action === "recheck_stock") await orderQuery.refetch();
      return false;
    }
  };

  if (loading && !order) {
    return (
      <div className="flex min-h-[360px] items-center justify-center text-sm text-gray-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-pink-600" />
        Memuat order produksi...
      </div>
    );
  }

  if (!order) {
    return (
      <div className="space-y-4">
        <PurchasingFormHeader
          backHref={config.productionHubRoute}
          title="Order Produksi"
          description="Order produksi yang diminta tidak dapat dimuat."
        />
        <div className="rounded-xl border border-red-100 bg-red-50 px-5 py-4 text-sm font-medium text-red-700">
          Order produksi tidak ditemukan
        </div>
      </div>
    );
  }

  const shortMaterials = order.materials.filter((material) => toNumber(material.stock?.shortage_qty) > 0);
  const hasShortage = shortMaterials.length > 0;
  const materialCost = toNumber(order.actual_material_cost) || toNumber(order.planned_material_cost);
  const recheckButton = (tone: string) => (
    <Button
      type="button"
      variant="outline"
      onClick={() => void runAction("recheck_stock")}
      disabled={loading}
      className={`${ORDER_ACTION_BUTTON} ${tone}`}
    >
      <RefreshCw className="h-4 w-4" />
      Cek Ulang Stok
    </Button>
  );

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={config.productionHubRoute}
        title={order.nomor_produksi}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>{displayName(order.product_nama || order.output_raw_material_nama || order.item_nama)}</span>
            <span className="text-gray-300">·</span>
            <span>{formatDate(order.created_at)}</span>
            <Badge variant="outline" className={productionStatusClass(order.status)}>
              {productionStatusLabel(order.status)}
            </Badge>
            <Badge
              variant="outline"
              className={
                order.output_type === "WIP"
                  ? "border-sky-200/80 bg-sky-50 text-sky-700"
                  : "border-emerald-200/80 bg-emerald-50 text-emerald-700"
              }
            >
              {order.output_type === "WIP" ? "WIP" : "Barang Jadi"}
            </Badge>
          </span>
        }
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => void orderQuery.refetch()}
              disabled={loading}
              className={SECONDARY_ACTION}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Muat Ulang
            </Button>
            {isActiveProductionStatus(order.status) &&
              recheckButton("border-emerald-200/80 bg-white text-emerald-700 hover:bg-emerald-50")}
            {order.status === "DRAFT" && (
              <Button
                type="button"
                variant="outline"
                onClick={() => void runAction("release")}
                disabled={loading || hasShortage}
                className={`${ORDER_ACTION_BUTTON} border-amber-200/80 bg-white text-amber-700 hover:bg-amber-50`}
              >
                <CheckCircle2 className="h-4 w-4" />
                Dirilis
              </Button>
            )}
            {order.status === "RELEASED" && (
              <Button
                type="button"
                variant="outline"
                onClick={() => void runAction("start")}
                disabled={loading}
                className={`${ORDER_ACTION_BUTTON} border-sky-200/80 bg-white text-sky-700 hover:bg-sky-50`}
              >
                <Play className="h-4 w-4" />
                Mulai
              </Button>
            )}
            {order.status === "IN_PROGRESS" && (
              <Button
                type="button"
                onClick={() => setCompleteOpen(true)}
                disabled={loading || hasShortage}
                className={MAIN_ACTION}
              >
                <PackageCheck className="h-4 w-4" />
                Terima Output
              </Button>
            )}
            {!["COMPLETED", "CANCELLED"].includes(order.status) && (
              <Button
                type="button"
                variant="outline"
                onClick={() => void runAction("cancel")}
                disabled={loading}
                className={DESTRUCTIVE_ACTION}
              >
                Batal
              </Button>
            )}
          </>
        }
      />

      {hasShortage && (
        <Card className="border-red-200/70 bg-red-50/50 shadow-xs">
          <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
              <div>
                <h2 className="text-sm font-semibold text-red-800">Stok tidak cukup</h2>
                <p className="mt-1 text-sm text-red-700">
                  Dirilis atau terima output akan diblokir sampai kekurangan bahan di bawah ini teratasi.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {recheckButton("border-red-200/80 bg-white text-red-700 hover:bg-red-50")}
              <Link
                href={shortagePoHref(config.purchasingPoInsertRoute, order, shortMaterials)}
                className={`${ORDER_ACTION_BUTTON} bg-red-600 text-white hover:bg-red-700`}
              >
                Buat Purchase Order
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      <ProductionOrderStats order={order} materialCost={materialCost} />
      <ProductionOrderMaterialsCard
        order={order}
        shortageCount={shortMaterials.length}
        poInsertRoute={config.purchasingPoInsertRoute}
      />
      <ProductionOrderCostAndBatches order={order} materialCost={materialCost} />

      <CompleteProductionDialog
        order={order}
        open={completeOpen}
        submitting={loading}
        onClose={() => setCompleteOpen(false)}
        onSubmit={async ({ action, ...payload }) => {
          if (await runAction(action, payload)) setCompleteOpen(false);
        }}
      />
    </div>
  );
}
