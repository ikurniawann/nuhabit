"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { DsDateTimePicker } from "@/components/design-system";
import {
  PurchasingFormFooter,
  PurchasingFormHeader,
} from "@/features/purchasing/components/shared/purchasing-page-header";
import { getReturnsModuleConfig } from "../returns-module";
import type { PurchasingModuleType } from "@/lib/purchasing/module-scope";
import { useReturn, useReturnFormData } from "../queries";
import { useUpdateReturn } from "../mutations";
import { ReturnReasonType, ReturnableItem, ReturnStatus } from "@/types/purchasing";
import {
  AlertCircle,
  ArrowLeftIcon,
  ClipboardList,
  Loader2,
  Package,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { formatNumber } from "@/lib/format";
import { ReturnItemsTable } from "./return-items-table";

const EDITABLE_STATUSES: ReturnStatus[] = ["draft", "pending_approval"];

const RETURN_REASON_OPTIONS: { value: ReturnReasonType; label: string }[] = [
  { value: "damaged", label: "Barang Rusak" },
  { value: "wrong_item", label: "Barang Salah" },
  { value: "expired", label: "Kedaluwarsa" },
  { value: "overstock", label: "Kelebihan Stok" },
  { value: "specification_mismatch", label: "Tidak Sesuai Spesifikasi" },
  { value: "other", label: "Lainnya" },
];

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

interface ReturnItem extends ReturnableItem {
  selected: boolean;
  qty_return: number;
  condition_notes: string;
}

export function EditReturnPage({
  moduleType = "raw_material",
}: {
  moduleType?: PurchasingModuleType;
}) {
  const config = getReturnsModuleConfig(moduleType);
  const router = useRouter();
  const params = useParams();
  const returnId = params.id as string;

  const detailQuery = useReturn(returnId);
  const existingReturn = detailQuery.data ?? null;

  const grnId = existingReturn?.grn_id || "";
  const formDataQuery = useReturnFormData(grnId || null, returnId);
  const loadingItems = Boolean(grnId) && formDataQuery.isLoading;

  const [returnableItems, setReturnableItems] = useState<ReturnItem[]>([]);
  const [formData, setFormData] = useState({
    return_date: "",
    reason_type: "" as ReturnReasonType | "",
    reason_notes: "",
    notes: "",
  });

  const itemsInitializedRef = useRef(false);
  const headerInitializedRef = useRef(false);

  const updateMutation = useUpdateReturn();
  const isSubmitting = updateMutation.isPending;

  useEffect(() => {
    if (!existingReturn || headerInitializedRef.current) return;
    headerInitializedRef.current = true;
    setFormData({
      return_date: existingReturn.return_date,
      reason_type: existingReturn.reason_type,
      reason_notes: existingReturn.reason_notes || "",
      notes: existingReturn.notes || "",
    });
  }, [existingReturn]);

  useEffect(() => {
    if (itemsInitializedRef.current || !existingReturn || !formDataQuery.data?.returnableItems) {
      return;
    }

    const existingByGrnItem = new Map(
      (existingReturn.items || [])
        .filter((item) => item.grn_item_id)
        .map((item) => [item.grn_item_id as string, item])
    );

    setReturnableItems(
      formDataQuery.data.returnableItems.map((item: ReturnableItem) => {
        const existing = existingByGrnItem.get(item.grn_item_id);
        if (existing) {
          return {
            ...item,
            unit_price: Number(existing.unit_cost) || item.unit_price,
            selected: true,
            qty_return: Number(existing.qty_returned),
            condition_notes: existing.condition_notes || "",
          };
        }
        return {
          ...item,
          selected: false,
          qty_return: 0,
          condition_notes: "",
        };
      })
    );
    itemsInitializedRef.current = true;
  }, [existingReturn, formDataQuery.data]);

  useEffect(() => {
    if (formDataQuery.isError) {
      toast.error("Gagal memuat item yang dapat diretur");
    }
  }, [formDataQuery.isError]);

  const toggleItem = (grnItemId: string) => {
    setReturnableItems((items) =>
      items.map((item) =>
        item.grn_item_id === grnItemId ? { ...item, selected: !item.selected } : item
      )
    );
  };

  const toggleAllItems = (checked: boolean) => {
    setReturnableItems((items) => items.map((item) => ({ ...item, selected: checked })));
  };

  const updateQtyReturn = (grnItemId: string, qty: number) => {
    setReturnableItems((items) =>
      items.map((item) =>
        item.grn_item_id === grnItemId
          ? {
              ...item,
              qty_return: Math.min(Math.max(0, qty), item.qty_available_to_return),
              selected: qty > 0 ? true : item.selected,
            }
          : item
      )
    );
  };

  const updateConditionNotes = (grnItemId: string, notes: string) => {
    setReturnableItems((items) =>
      items.map((item) =>
        item.grn_item_id === grnItemId ? { ...item, condition_notes: notes } : item
      )
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (
      !existingReturn?.grn_id ||
      (config.isProduct ? !existingReturn.vendor_id : !existingReturn.supplier_id)
    ) {
      toast.error("Data retur tidak lengkap");
      return;
    }
    if (!formData.reason_type) {
      toast.error("Alasan retur wajib diisi");
      return;
    }

    const selectedItems = returnableItems.filter(
      (item) => item.selected && item.qty_return > 0
    );

    if (selectedItems.length === 0) {
      toast.error("Pilih minimal satu item dengan qty retur");
      return;
    }

    for (const item of selectedItems) {
      if (item.qty_return > item.qty_available_to_return) {
        const { nama } = config.itemName(item);
        toast.error(`Qty retur untuk ${nama} melebihi qty yang tersedia`);
        return;
      }
    }

    try {
      await updateMutation.mutateAsync({
        id: returnId,
        data: {
          grn_id: existingReturn.grn_id,
          ...(config.isProduct
            ? { vendor_id: existingReturn.vendor_id ?? undefined, module_type: "product" as const }
            : { supplier_id: existingReturn.supplier_id ?? undefined }),
          return_date: formData.return_date,
          reason_type: formData.reason_type as ReturnReasonType,
          reason_notes: formData.reason_notes,
          notes: formData.notes,
          items: selectedItems.map((item) => ({
            grn_item_id: item.grn_item_id,
            ...(config.isProduct
              ? { product_id: item.product_id }
              : { raw_material_id: item.raw_material_id }),
            qty_returned: item.qty_return,
            unit_cost: item.unit_price,
            batch_number: item.batch_number,
            expiry_date: item.expiry_date,
            condition_notes: item.condition_notes,
          })),
        },
      });
      toast.success("Retur pembelian berhasil diperbarui");
      router.push(config.detailRoute(returnId));
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Gagal memperbarui retur pembelian"));
    }
  };

  const selectedCount = returnableItems.filter((i) => i.selected && i.qty_return > 0).length;
  const totalQty = returnableItems
    .filter((i) => i.selected)
    .reduce((sum, i) => sum + i.qty_return, 0);
  const totalAmount = returnableItems
    .filter((i) => i.selected)
    .reduce((sum, i) => sum + i.qty_return * i.unit_price, 0);


  if (detailQuery.isLoading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-pink-600" />
      </div>
    );
  }

  if (detailQuery.isError || !existingReturn) {
    return (
      <div className="space-y-4">
        <Link href={config.listRoute}>
          <Button variant="ghost" size="sm" className="h-9 gap-2 text-pink-700">
            <ArrowLeftIcon className="h-4 w-4" />
            Kembali
          </Button>
        </Link>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="py-12 text-center text-sm text-gray-500">
            Retur pembelian tidak ditemukan atau gagal dimuat.
          </CardContent>
        </Card>
      </div>
    );
  }

  const status = existingReturn.status as ReturnStatus;
  if (!EDITABLE_STATUSES.includes(status)) {
    return (
      <div className="space-y-4">
        <Link href={config.detailRoute(returnId)}>
          <Button variant="ghost" size="sm" className="h-9 gap-2 text-pink-700">
            <ArrowLeftIcon className="h-4 w-4" />
            Kembali
          </Button>
        </Link>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="py-12 text-center text-sm text-gray-500">
            Retur pembelian ini tidak dapat diubah lagi setelah disetujui.
          </CardContent>
        </Card>
      </div>
    );
  }

  const grnNumber =
    existingReturn.grn?.grn_number || existingReturn.grn?.nomor_grn || "-";

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={config.detailRoute(returnId)}
        title={`Ubah ${existingReturn.return_number}`}
        description="Perbarui detail retur sebelum disetujui. Stok dikurangi dari stall penerimaan saat disetujui."
      />

      <form id="purchase-return-edit-form" onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          <div className="space-y-6 xl:col-span-8">
            <Card className="border-gray-200/70 shadow-xs">
              <CardHeader className="border-b border-gray-200/70 pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ClipboardList className="h-4 w-4 text-pink-600" />
                  Informasi Retur
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-4">
                <div className="grid grid-cols-1 gap-3 rounded-xl border border-gray-200/70 bg-gray-50/60 p-4 text-sm md:grid-cols-2">
                  <div>
                    <p className="text-xs text-gray-500">Penerimaan Barang</p>
                    <p className="font-medium text-gray-900">{grnNumber}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">{config.partyLabel}</p>
                    <p className="font-medium text-gray-900">
                      {config.partyNameFromReturn(existingReturn)}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <DsDateTimePicker
                    label="Tanggal Retur"
                    value={formData.return_date}
                    onChange={(value) =>
                      setFormData((prev) => ({ ...prev, return_date: value }))
                    }
                    placeholder="Pilih tanggal retur..."
                    dateOnly
                    required
                  />
                  <div className="min-w-0 space-y-1.5">
                    <Label className="text-xs">
                      Alasan Retur <span className="text-red-500">*</span>
                    </Label>
                    <Combobox
                      options={RETURN_REASON_OPTIONS}
                      value={formData.reason_type}
                      onChange={(value) =>
                        setFormData((prev) => ({
                          ...prev,
                          reason_type: value as ReturnReasonType,
                        }))
                      }
                      placeholder="Pilih alasan..."
                      searchPlaceholder="Cari alasan..."
                      emptyMessage="Alasan tidak ditemukan"
                      className="w-full! h-9 text-sm"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="reason_notes" className="text-xs">
                    Catatan Alasan
                  </Label>
                  <Textarea
                    id="reason_notes"
                    placeholder="Jelaskan alasan retur secara detail..."
                    value={formData.reason_notes}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, reason_notes: e.target.value }))
                    }
                    rows={3}
                    className="resize-none text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="notes" className="text-xs">
                    Catatan Internal
                  </Label>
                  <Textarea
                    id="notes"
                    placeholder="Catatan internal (opsional)..."
                    value={formData.notes}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, notes: e.target.value }))
                    }
                    rows={2}
                    className="resize-none text-sm"
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="border-gray-200/70 shadow-xs">
              <CardHeader className="border-b border-gray-200/70 pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Package className="h-4 w-4 text-pink-600" />
                  Item yang Diretur
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {loadingItems ? (
                  <div className="flex items-center justify-center py-14">
                    <Loader2 className="h-6 w-6 animate-spin text-pink-600" />
                  </div>
                ) : returnableItems.length === 0 ? (
                  <div className="flex flex-col items-center px-4 py-14 text-center">
                    <AlertCircle className="mb-3 h-10 w-10 text-gray-300" />
                    <p className="text-sm text-gray-600">Item yang dapat diretur tidak ditemukan</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto p-4">
                    <ReturnItemsTable
                      variant="edit"
                      items={returnableItems}
                      isProduct={config.isProduct}
                      itemName={config.itemName}
                      onToggle={toggleItem}
                      onToggleAll={toggleAllItems}
                      onQtyChange={updateQtyReturn}
                      onNotesChange={updateConditionNotes}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="xl:col-span-4">
            <Card className="border-gray-200/70 shadow-xs xl:sticky xl:top-6">
              <CardHeader className="border-b border-gray-200/70 pb-3">
                <CardTitle className="text-base">Ringkasan</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-4">
                <dl className="space-y-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-gray-500">Item Terpilih</dt>
                    <dd className="font-medium text-gray-900">{selectedCount}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-gray-500">Total Qty</dt>
                    <dd className="font-medium text-gray-900">{formatNumber(totalQty, 4)}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-3 border-t border-gray-200/70 pt-3">
                    <dt className="font-medium text-gray-900">Nilai Total</dt>
                    <dd className="font-semibold text-pink-700">{formatNumber(totalAmount)}</dd>
                  </div>
                </dl>

                <div className="rounded-xl border border-amber-200/80 bg-amber-50/60 p-4 text-xs text-amber-800">
                  <div className="flex items-start gap-2">
                    <RotateCcw className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>
                      Saat disetujui, stok akan dikurangi dari stall yang sama dengan tempat barang
                      diterima pada saat posting QC GRN.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <PurchasingFormFooter
          formId="purchase-return-edit-form"
          submitLabel={isSubmitting ? "Menyimpan..." : "Simpan Perubahan"}
          loading={isSubmitting}
          onCancel={() => router.push(config.detailRoute(returnId))}
        />
      </form>
    </div>
  );
}
