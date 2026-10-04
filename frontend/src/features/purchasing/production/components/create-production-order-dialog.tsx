"use client";

import { useState } from "react";
import { Box, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelForm,
  DialogPanelHeader,
  DialogPanelTitle,
  DialogPanelToolbar,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatNumber } from "@/lib/format";
import type { PurchasingModuleType } from "@/lib/purchasing/module-scope";
import { displayName, toNumber } from "@/lib/purchasing/production-ui-display";
import {
  aggregateAdditionalCosts,
  buildCreateOrderPayload,
  createAdditionalCostLine,
  estimateProductionOrder,
  type AdditionalCostLine,
} from "@/lib/purchasing/production-ui-order-form";
import { useErrorToast } from "@/features/purchasing/reports/use-error-toast";
import { useCreateProductionOrder } from "../mutations";
import { useProductionCogs } from "../queries";
import type { ProductionProduct } from "../types";
import { AdditionalCostsCard } from "./additional-costs-card";
import { ProductionBomPreview } from "./production-bom-preview";

type CreateProductionOrderDialogProps = {
  moduleType: PurchasingModuleType;
  item: ProductionProduct | null;
  bomEditorHref: (id: string) => string;
  onClose: () => void;
  onCreated: () => void;
};

export function CreateProductionOrderDialog({ item, onClose, ...props }: CreateProductionOrderDialogProps) {
  return (
    <Dialog open={!!item} onOpenChange={(open) => !open && onClose()}>
      {item && <CreateProductionOrderPanel key={item.id} item={item} onClose={onClose} {...props} />}
    </Dialog>
  );
}

function CreateProductionOrderPanel({
  moduleType,
  item,
  bomEditorHref,
  onClose,
  onCreated,
}: Omit<CreateProductionOrderDialogProps, "item"> & { item: ProductionProduct }) {
  const isProduct = moduleType === "product";
  const [plannedQty, setPlannedQty] = useState("1");
  const [costLines, setCostLines] = useState<AdditionalCostLine[]>(() => [createAdditionalCostLine()]);

  const createMutation = useCreateProductionOrder();
  const cogsQuery = useProductionCogs(moduleType, item.id);
  useErrorToast(cogsQuery.error, "Gagal memuat resep (BOM)");

  const qty = Math.max(0, toNumber(plannedQty));
  const costs = aggregateAdditionalCosts(costLines);
  const bomLines = cogsQuery.data?.breakdown_bahan ?? [];
  const estimate = estimateProductionOrder(cogsQuery.data, qty, costs.total);
  const editHref = `${bomEditorHref(item.id)}?from=production`;

  const updateLine = (id: string, changes: Partial<AdditionalCostLine>) =>
    setCostLines((lines) => lines.map((line) => (line.id === id ? { ...line, ...changes } : line)));

  const removeLine = (id: string) =>
    setCostLines((lines) => {
      const next = lines.filter((line) => line.id !== id);
      return next.length > 0 ? next : [createAdditionalCostLine()];
    });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (qty <= 0) return;
    try {
      const message = await createMutation.mutateAsync(buildCreateOrderPayload(isProduct, item, qty, costs));
      toast.success(message || "Order produksi dibuat. Gunakan Dirilis di daftar order untuk melanjutkan alur.");
      onCreated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal membuat order produksi");
    }
  };

  return (
    <DialogPanel size="2xl" className="max-h-[min(92vh,960px)]">
      <DialogPanelForm onSubmit={submit}>
        <DialogPanelHeader>
          <DialogPanelTitle>Buat Order Produksi</DialogPanelTitle>
          <DialogPanelDescription>
            Atur kuantitas output, tinjau kelengkapan resep (BOM), dan kirim order produksi draf.
          </DialogPanelDescription>
        </DialogPanelHeader>

        <DialogPanelToolbar>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-gray-900">{displayName(item.nama)}</p>
              <p className="text-xs text-gray-500">
                {item.kode || "-"}
                {item.kategori ? ` · ${item.kategori}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {isProduct && (
                <Badge
                  variant="outline"
                  className={
                    item.production_output_type === "WIP"
                      ? "border-sky-200/80 bg-sky-50 text-sky-700"
                      : "border-emerald-200/80 bg-emerald-50 text-emerald-700"
                  }
                >
                  {item.production_output_type === "WIP" ? "WIP" : "Barang Jadi"}
                </Badge>
              )}
              <Badge variant="outline" className="border-emerald-200/80 bg-emerald-50 text-emerald-700">
                {formatNumber(item.total_bahan_baku, 3)} komponen
              </Badge>
              <Badge variant="outline" className="border-pink-200/80 bg-pink-50 text-pink-700">
                Est. HPP {formatNumber(item.hpp_estimasi)}
              </Badge>
              {estimate.shortages.length > 0 && (
                <Badge variant="outline" className="border-red-200/80 bg-red-50 text-red-700">
                  {estimate.shortages.length} kekurangan
                </Badge>
              )}
            </div>
          </div>
        </DialogPanelToolbar>

        <DialogPanelBody className="space-y-5">
          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Kuantitas Target</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-w-xs space-y-2">
                <Label className="text-xs text-gray-600">
                  Kuantitas <span className="text-red-500">*</span>
                </Label>
                <Input
                  value={plannedQty}
                  onChange={(event) => setPlannedQty(event.target.value)}
                  type="number"
                  min="0"
                  step="any"
                  className="h-10 text-sm focus:border-pink-400 focus:ring-1 focus:ring-pink-100"
                />
              </div>
            </CardContent>
          </Card>

          <ProductionBomPreview
            isProduct={isProduct}
            materials={bomLines}
            plannedQty={qty}
            materialCost={estimate.materialCost}
            loading={cogsQuery.isLoading}
            failed={cogsQuery.isError}
            onRetry={() => void cogsQuery.refetch()}
            bomEditorHref={editHref}
          />

          <AdditionalCostsCard
            lines={costLines}
            total={costs.total}
            onAdd={() => setCostLines((lines) => [...lines, createAdditionalCostLine()])}
            onChange={updateLine}
            onRemove={removeLine}
          />

          <Card className="border-pink-100/80 bg-pink-50/40 shadow-xs">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-pink-800">Pratinjau HPP</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-gray-600">Bahan</span>
                <span className="font-semibold tabular-nums text-gray-900">{formatNumber(estimate.materialCost)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-gray-600">Tambahan</span>
                <span className="font-semibold tabular-nums text-gray-900">{formatNumber(costs.total)}</span>
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-pink-100/80 pt-2">
                <span className="font-medium text-pink-700">HPP / Unit</span>
                <span className="text-base font-bold tabular-nums text-pink-800">
                  {formatNumber(estimate.hppPerUnit || item.hpp_estimasi)}
                </span>
              </div>
            </CardContent>
          </Card>
        </DialogPanelBody>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={createMutation.isPending}
            className="purchasing-secondary-button"
          >
            Batal
          </Button>
          <Button
            type="submit"
            disabled={createMutation.isPending || qty <= 0 || cogsQuery.isLoading || bomLines.length === 0}
            className="purchasing-main-button gap-2"
          >
            {createMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Membuat...
              </>
            ) : (
              <>
                <Box className="h-4 w-4" />
                Buat Order Produksi
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogPanelForm>
    </DialogPanel>
  );
}
