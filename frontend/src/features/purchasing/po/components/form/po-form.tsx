"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Package } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { DsDateTimePicker } from "@/components/design-system";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  PurchasingFormFooter,
  PurchasingFormHeader,
} from "@/features/purchasing/components/shared/purchasing-page-header";
import { getRawMaterialPurchasePrice } from "@/lib/purchasing/api-client/raw-materials";
import { RM_ROUTES } from "@/lib/purchasing/item-routes";
import {
  buildCreatePOPayload,
  buildUpdatePOPayload,
  poFormTotals,
  priceLookupUnitId,
  validatePOForm,
  withPurchasePrice,
  withQtyOrPrice,
  type POItemForm,
} from "@/lib/purchasing/po-form-items";
import type { PurchaseOrderFormData, RawMaterialWithStock, Unit } from "@/types/purchasing";
import type { POFormData } from "../../api";
import { useCreatePurchaseOrder, useUpdatePurchaseOrder } from "../../mutations";
import { POItemsSection, POSummaryCard, PRSourceCard, type PRSource } from "./po-form-sections";

/** Harga beli saran (biaya GRN terakhir) untuk satuan baris; baris tetap apa adanya bila tidak ada saran. */
async function priceItem(
  item: POItemForm,
  supplierId: string,
  materials: RawMaterialWithStock[],
  units: Unit[]
): Promise<POItemForm> {
  const unitId = priceLookupUnitId(item, materials);
  if (!item.raw_material_id || !unitId) return item;
  try {
    const suggestion = await getRawMaterialPurchasePrice(item.raw_material_id, { supplierId, satuanId: unitId });
    if (!suggestion || suggestion.unit_price <= 0) return item;
    return withPurchasePrice(item, suggestion.unit_price, unitId, units.find((u) => u.id === unitId)?.nama || "");
  } catch {
    return item;
  }
}

interface POFormProps {
  /** Ada = ubah PO draf (hanya header); kosong = buat PO dari purchase request. */
  poId?: string;
  title: string;
  description: string;
  initialForm: PurchaseOrderFormData;
  initialItems: POItemForm[];
  prSource: PRSource | null;
  lookups: POFormData;
}

export function POForm({ poId, title, description, initialForm, initialItems, prSource, lookups }: POFormProps) {
  const router = useRouter();
  const isEditMode = Boolean(poId);
  const [form, setForm] = useState(initialForm);
  const [items, setItems] = useState(initialItems);
  const createMutation = useCreatePurchaseOrder();
  const updateMutation = useUpdatePurchaseOrder();
  const isSubmitting = createMutation.isPending || updateMutation.isPending;
  const totals = poFormTotals(items, form);
  const backHref = poId ? RM_ROUTES.purchasingPoDetail(poId) : RM_ROUTES.purchasingPo;
  const patch = (values: Partial<PurchaseOrderFormData>) => setForm((prev) => ({ ...prev, ...values }));

  const handleSupplierChange = async (supplierId: string) => {
    patch({ supplier_id: supplierId });
    // Item PO draf terkunci, jadi harga hanya disarankan saat membuat PO baru.
    if (!supplierId || isEditMode || items.length === 0) return;
    setItems(await Promise.all(items.map((item) => priceItem(item, supplierId, lookups.materials, lookups.units))));
  };

  const handleItemChange = (index: number, field: "qty_ordered" | "harga_satuan", value: number) =>
    setItems((prev) => prev.map((item, i) => (i === index ? withQtyOrPrice(item, field, value) : item)));

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const invalid = validatePOForm(form, items, isEditMode);
    if (invalid) {
      toast.error(invalid);
      return;
    }
    try {
      if (poId) {
        await updateMutation.mutateAsync({ id: poId, payload: buildUpdatePOPayload(form) });
        toast.success("PO berhasil disubmit");
        router.push(`/dashboard/purchasing/po/${poId}?updated=1`);
        return;
      }
      const po = await createMutation.mutateAsync(buildCreatePOPayload(form, items));
      toast.success("PO berhasil dibuat");
      router.push(`/dashboard/purchasing/po/${po.id}`);
    } catch (error) {
      const fallback = isEditMode ? "Gagal memperbarui purchase order" : "Gagal membuat purchase order";
      toast.error(error instanceof Error ? error.message : fallback);
    }
  };

  return (
    <div className="space-y-6">
      <PurchasingFormHeader backHref={backHref} title={title} description={description} />

      {prSource && (
        <PRSourceCard pr={prSource} onOpen={() => router.push(RM_ROUTES.purchasingPrDetail(prSource.id))} />
      )}

      <form id="purchase-order-form" onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          <Card className="border-gray-200/70 shadow-xs xl:col-span-8">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Package className="h-4 w-4" />
                Informasi Purchase Order
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="min-w-0 space-y-1.5">
                <Label className="text-xs">
                  Supplier <span className="text-red-500">*</span>
                </Label>
                <Combobox
                  options={lookups.suppliers.map((supplier) => ({
                    value: supplier.id,
                    label: supplier.nama_supplier,
                    description: supplier.kode_supplier,
                  }))}
                  value={form.supplier_id}
                  onChange={handleSupplierChange}
                  placeholder="Pilih supplier..."
                  searchPlaceholder="Cari supplier..."
                  emptyMessage="Supplier tidak ditemukan"
                  allowClear
                  className="w-full! h-9 text-sm"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <DsDateTimePicker
                  label="Tanggal PO"
                  value={form.tanggal_po}
                  onChange={(value) => patch({ tanggal_po: value })}
                  placeholder="Pilih tanggal PO..."
                  dateOnly
                />
                <DsDateTimePicker
                  label="Estimasi Tanggal Pengiriman"
                  value={form.tanggal_kirim_estimasi}
                  onChange={(value) => patch({ tanggal_kirim_estimasi: value })}
                  placeholder="Pilih estimasi tanggal pengiriman..."
                  dateOnly
                />
              </div>

              <div className="min-w-0 space-y-1.5">
                <Label className="text-xs">Catatan</Label>
                <Textarea
                  value={form.catatan}
                  onChange={(e) => patch({ catatan: e.target.value })}
                  placeholder="Catatan untuk supplier..."
                  rows={2}
                  className="resize-none text-sm"
                />
              </div>

              <div className="min-w-0 space-y-1.5">
                <Label className="text-xs">Alamat Pengiriman</Label>
                <Textarea
                  value={form.alamat_pengiriman}
                  onChange={(e) => patch({ alamat_pengiriman: e.target.value })}
                  placeholder="Alamat pengiriman..."
                  rows={2}
                  className="resize-none text-sm"
                />
              </div>
            </CardContent>
          </Card>

          <POSummaryCard
            totals={totals}
            diskonPersen={form.diskon_persen}
            ppnPersen={form.ppn_persen}
            onDiskonChange={(value) => patch({ diskon_persen: value, diskon_nominal: 0 })}
            onPpnChange={(value) => patch({ ppn_persen: value })}
          />
        </div>

        <POItemsSection items={items} locked={isEditMode} onChange={handleItemChange} />

        <PurchasingFormFooter
          onCancel={() => router.push(backHref)}
          submitLabel="Simpan"
          loading={isSubmitting}
          disabled={isSubmitting || (!isEditMode && !prSource)}
          formId="purchase-order-form"
        />
      </form>
    </div>
  );
}
