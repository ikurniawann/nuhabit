"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { NumericInput } from "@/components/ui/numeric-input";
import { PurchasingPageHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import { GENERAL_ROUTES } from "@/lib/purchasing/item-routes";
import { ArrowLeft, Loader2, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { useSupplyInventoryFormData } from "../queries";
import { useCreateSupplyAdjustment } from "../mutations";

export function SupplyAdjustmentPage() {
  const formData = useSupplyInventoryFormData();
  const adjustMutation = useCreateSupplyAdjustment();

  const [warehouseId, setWarehouseId] = useState("");
  const [supplyItemId, setSupplyItemId] = useState("");
  const [qtyActual, setQtyActual] = useState(0);
  const [notes, setNotes] = useState("");

  const warehouseOptions = useMemo(
    () => (formData.data?.warehouses ?? []).map((w) => ({ value: w.id, label: w.name })),
    [formData.data]
  );
  const supplyOptions = useMemo(
    () =>
      (formData.data?.supplies ?? []).map((s) => ({
        value: s.id,
        label: s.nama,
        description: s.kode,
      })),
    [formData.data]
  );

  const handleSubmit = async () => {
    if (!warehouseId || !supplyItemId) {
      toast.error("Pilih gudang dan barang");
      return;
    }
    try {
      const res = await adjustMutation.mutateAsync({
        supply_item_id: supplyItemId,
        warehouse_id: warehouseId,
        qty_actual: qtyActual,
        notes: notes || undefined,
      });
      toast.success(
        `Stok disesuaikan: ${res.qtyBefore} → ${res.qtyAfter} (${res.qtyDiff >= 0 ? "+" : ""}${res.qtyDiff})`
      );
      setNotes("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyesuaikan stok");
    }
  };

  const saving = adjustMutation.isPending;

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title="Penyesuaian Stok"
        description="Koreksi saldo stok barang operasional ke nilai aktual (opname/koreksi)"
        actions={
          <Link href={GENERAL_ROUTES.inventory}>
            <Button variant="outline" className="purchasing-secondary-button">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Ke Stok
            </Button>
          </Link>
        }
      />

      <Card className="mx-auto max-w-2xl border-gray-200/70 shadow-xs">
        <CardHeader className="border-b border-gray-200/70 pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <SlidersHorizontal className="h-4 w-4 text-pink-600" />
            Form Penyesuaian
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Gudang <span className="text-red-500">*</span></Label>
            <Combobox
              options={warehouseOptions}
              value={warehouseId}
              onChange={(v) => setWarehouseId(v || "")}
              placeholder="Pilih gudang..."
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Barang <span className="text-red-500">*</span></Label>
            <Combobox
              options={supplyOptions}
              value={supplyItemId}
              onChange={(v) => setSupplyItemId(v || "")}
              placeholder="Pilih barang..."
              searchPlaceholder="Cari..."
              emptyMessage="Barang tidak ditemukan"
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Stok Aktual (hasil hitung fisik)</Label>
            <NumericInput value={qtyActual} onValueChange={setQtyActual} decimalScale={3} className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Alasan / Catatan</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="resize-none text-sm" />
          </div>
          <div className="flex justify-end">
            <Button onClick={handleSubmit} disabled={saving} className="purchasing-main-button">
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Simpan Penyesuaian
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
