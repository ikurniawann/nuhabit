"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import { useReturnFormData, useReturnGrnOptions } from "../queries";
import { useCreateReturn } from "../mutations";
import { ReturnReasonType, ReturnableItem } from "@/types/purchasing";
import {
  AlertCircle,
  ClipboardList,
  Info,
  Loader2,
  Package,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { formatNumber } from "@/lib/format";
import { ReturnItemsTable } from "./return-items-table";

const RETURN_REASON_OPTIONS: { value: ReturnReasonType; label: string }[] = [
  { value: "damaged", label: "Barang Rusak" },
  { value: "wrong_item", label: "Barang Salah" },
  { value: "expired", label: "Kedaluwarsa" },
  { value: "overstock", label: "Kelebihan Stok" },
  { value: "specification_mismatch", label: "Tidak Sesuai Spesifikasi" },
  { value: "other", label: "Lainnya" },
];

const GUIDELINES = [
  "Hanya penerimaan barang yang sudah menyelesaikan quality control yang dapat diretur.",
  "Qty retur tidak boleh melebihi qty hasil posting QC dikurangi retur sebelumnya.",
  "Retur yang diajukan memerlukan persetujuan purchasing manager sebelum stok dikurangi.",
];

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

interface ItemEdit {
  selected: boolean;
  qty_return: number;
  condition_notes: string;
}

type ReturnItem = ReturnableItem & ItemEdit;

export function NewReturnPage({
  moduleType = "raw_material",
}: {
  moduleType?: PurchasingModuleType;
}) {
  const config = getReturnsModuleConfig(moduleType);
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialGrnId = searchParams.get("grn_id") || "";

  // grn_id dari URL mengunci pilihan penerimaan barang.
  const [pickedGrnId, setPickedGrnId] = useState(initialGrnId);
  const selectedGrnId = initialGrnId || pickedGrnId;
  const [itemEdits, setItemEdits] = useState<Record<string, ItemEdit>>({});
  const [formData, setFormData] = useState({
    return_date: new Date().toISOString().split("T")[0],
    reason_type: "" as ReturnReasonType | "",
    reason_notes: "",
    notes: "",
  });

  const grnOptionsQuery = useReturnGrnOptions(moduleType);
  const grnOptions = grnOptionsQuery.data ?? [];
  const formDataQuery = useReturnFormData(selectedGrnId || null);
  const loadingGrnOptions = grnOptionsQuery.isLoading;
  const loadingItems = Boolean(selectedGrnId) && formDataQuery.isLoading;

  const createMutation = useCreateReturn();
  const isSubmitting = createMutation.isPending;

  const selectedGrn = grnOptions.find((grn) => grn.id === selectedGrnId);

  useEffect(() => {
    if (grnOptionsQuery.isError) {
      toast.error("Gagal memuat opsi penerimaan barang");
    }
  }, [grnOptionsQuery.isError]);

  useEffect(() => {
    if (formDataQuery.isError) {
      toast.error("Gagal memuat item yang dapat diretur");
    }
  }, [formDataQuery.isError, formDataQuery.error]);

  const itemsData = selectedGrnId ? formDataQuery.data?.returnableItems : undefined;
  const returnableItems: ReturnItem[] = (itemsData ?? []).map((item) => ({
    ...item,
    selected: false,
    qty_return: 0,
    condition_notes: "",
    ...(itemEdits[item.grn_item_id] as ItemEdit | undefined),
  }));
  // Pihak retur (supplier/vendor) mengikuti item pertama, atau GRN terpilih bila belum ada item.
  const party = itemsData?.[0] ?? selectedGrn;
  const grnId = itemsData?.[0]?.grn_id ?? selectedGrnId;
  const supplierId = config.isProduct ? "" : party?.supplier_id || "";
  const vendorId = config.isProduct ? party?.vendor_id || "" : "";

  const handleGrnChange = (nextGrnId: string) => {
    setPickedGrnId(nextGrnId);
    setItemEdits({});
  };

  const editItem = (grnItemId: string, patch: (item: ReturnItem) => Partial<ItemEdit>) => {
    const item = returnableItems.find((row) => row.grn_item_id === grnItemId);
    if (!item) return;
    setItemEdits((edits) => ({
      ...edits,
      [grnItemId]: {
        selected: item.selected,
        qty_return: item.qty_return,
        condition_notes: item.condition_notes,
        ...patch(item),
      },
    }));
  };

  const toggleItem = (grnItemId: string) => editItem(grnItemId, (item) => ({ selected: !item.selected }));

  const toggleAllItems = (checked: boolean) => {
    setItemEdits(
      Object.fromEntries(
        returnableItems.map((item) => [
          item.grn_item_id,
          { selected: checked, qty_return: item.qty_return, condition_notes: item.condition_notes },
        ])
      )
    );
  };

  const updateQtyReturn = (grnItemId: string, qty: number) =>
    editItem(grnItemId, (item) => ({
      qty_return: Math.min(Math.max(0, qty), item.qty_available_to_return),
      selected: qty > 0 ? true : item.selected,
    }));

  const updateConditionNotes = (grnItemId: string, notes: string) =>
    editItem(grnItemId, () => ({ condition_notes: notes }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!grnId) {
      toast.error("Penerimaan barang wajib diisi");
      return;
    }
    if (config.isProduct ? !vendorId : !supplierId) {
      toast.error(`${config.partyLabel} wajib diisi`);
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
      await createMutation.mutateAsync({
        grn_id: grnId,
        ...(config.isProduct
          ? { vendor_id: vendorId, module_type: "product" as const }
          : { supplier_id: supplierId }),
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
      });
      toast.success("Retur pembelian berhasil dibuat dan menunggu persetujuan");
      router.push(config.listRoute);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Gagal membuat retur pembelian"));
    }
  };

  const selectedCount = returnableItems.filter((i) => i.selected && i.qty_return > 0).length;
  const totalQty = returnableItems
    .filter((i) => i.selected)
    .reduce((sum, i) => sum + i.qty_return, 0);
  const totalAmount = returnableItems
    .filter((i) => i.selected)
    .reduce((sum, i) => sum + i.qty_return * i.unit_price, 0);


  if (loadingGrnOptions && !grnOptions.length) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-pink-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={config.listRoute}
        title="Tambah Retur Pembelian"
        description={`Retur barang yang sudah selesai QC ke ${config.partyLabel.toLowerCase()}.`}
      />

      <form id="purchase-return-form" onSubmit={handleSubmit} className="space-y-6">
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
                <div className="min-w-0 space-y-1.5">
                  <Label className="text-xs">
                    Penerimaan Barang <span className="text-red-500">*</span>
                  </Label>
                  <Combobox
                    options={grnOptions.map((grn) => ({
                      value: grn.id,
                      label: grn.nomor_grn,
                      description: config.partyNameFromGrn(grn) || undefined,
                    }))}
                    value={selectedGrnId}
                    onChange={handleGrnChange}
                    placeholder={
                      loadingGrnOptions ? "Memuat penerimaan barang..." : "Pilih penerimaan barang"
                    }
                    searchPlaceholder="Cari nomor GRN..."
                    emptyMessage="Penerimaan barang yang selesai QC tidak ditemukan"
                    disabled={loadingGrnOptions}
                    className="w-full! h-9 text-sm"
                  />
                  <p className="text-xs text-gray-500">
                    Hanya penerimaan dengan quality control selesai yang ditampilkan.
                  </p>
                </div>

                {selectedGrn && (
                  <div className="grid grid-cols-1 gap-3 rounded-xl border border-gray-200/70 bg-gray-50/60 p-4 text-sm md:grid-cols-2">
                    <div>
                      <p className="text-xs text-gray-500">Nomor GRN</p>
                      <p className="font-medium text-gray-900">{selectedGrn.nomor_grn}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">{config.partyLabel}</p>
                      <p className="font-medium text-gray-900">
                        {config.partyNameFromGrn(selectedGrn)}
                      </p>
                    </div>
                  </div>
                )}

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
                  Pilih Item untuk Diretur
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {!selectedGrnId ? (
                  <div className="flex flex-col items-center py-14 text-center text-sm text-gray-500">
                    <RotateCcw className="mb-3 h-10 w-10 text-gray-300" />
                    Pilih penerimaan barang untuk melihat item yang dapat diretur.
                  </div>
                ) : loadingItems ? (
                  <div className="flex items-center justify-center py-14">
                    <Loader2 className="h-6 w-6 animate-spin text-pink-600" />
                  </div>
                ) : returnableItems.length === 0 ? (
                  <div className="flex flex-col items-center px-4 py-14 text-center">
                    <AlertCircle className="mb-3 h-10 w-10 text-gray-300" />
                    <p className="text-sm text-gray-600">Item yang dapat diretur tidak ditemukan</p>
                    <p className="mt-1 max-w-md text-xs text-gray-500">
                      Penerimaan barang ini tidak memiliki qty hasil posting QC yang tersedia untuk
                      diretur, atau semua qty sudah diretur.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto p-4">
                    <ReturnItemsTable
                      variant="create"
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
                    <dd className="font-semibold text-pink-700">
                      {formatNumber(totalAmount)}
                    </dd>
                  </div>
                </dl>

                <div className="rounded-xl border border-gray-200/70 bg-gray-50/60 p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-900">
                    <Info className="h-4 w-4 text-pink-600" />
                    Panduan
                  </div>
                  <ul className="space-y-2 text-xs leading-5 text-gray-600">
                    {GUIDELINES.map((line) => (
                      <li key={line} className="flex gap-2">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gray-400" />
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {selectedCount > 0 && (
                  <div className="rounded-xl border border-gray-200/70 bg-white p-4">
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-900">
                      <Package className="h-4 w-4 text-pink-600" />
                      Pratinjau Item
                    </div>
                    <ul className="space-y-2 text-xs text-gray-600">
                      {returnableItems
                        .filter((item) => item.selected && item.qty_return > 0)
                        .slice(0, 4)
                        .map((item) => {
                          const itemDisplay = config.itemName(item);
                          return (
                          <li
                            key={item.grn_item_id}
                            className="flex items-center justify-between gap-3"
                          >
                            <span className="truncate">{itemDisplay.nama}</span>
                            <span className="shrink-0 font-medium text-gray-900">
                              {formatNumber(item.qty_return, 4)}
                            </span>
                          </li>
                          );
                        })}
                      {selectedCount > 4 && (
                        <li className="text-gray-500">+{selectedCount - 4} item lainnya</li>
                      )}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        <PurchasingFormFooter
          onCancel={() => router.push(config.listRoute)}
          submitLabel="Simpan Retur"
          loading={isSubmitting}
          disabled={!selectedGrnId || selectedCount === 0 || totalQty <= 0}
          formId="purchase-return-form"
        />
      </form>
    </div>
  );
}
