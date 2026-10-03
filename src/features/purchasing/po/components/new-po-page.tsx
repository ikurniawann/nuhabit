"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClipboardList, Package, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Combobox } from "@/components/ui/combobox";
import { DsDateTimePicker } from "@/components/design-system";
import { NumericInput } from "@/components/ui/numeric-input";
import {
  PurchasingFormHeader,
  PurchasingFormFooter,
} from "@/modules/purchasing/components/page/purchasing-page-header";
import { Supplier, RawMaterialWithStock, PurchaseOrderFormData, PurchaseOrderItemFormData, Unit, PurchaseOrderItem } from "@/types/purchasing";
import { updatePurchaseOrder } from "../api";
import { getRawMaterialPurchasePrice } from "@/lib/purchasing";
import { getPurchaseRequest } from "@/features/purchasing/pr/api";
import { RM_ROUTES } from "@/modules/purchasing/constants/item-routes";
import { usePOFormData, usePurchaseOrder } from "../queries";
import { useCreatePurchaseOrder } from "../mutations";
import { formatAmount } from "@/lib/purchasing/utils";
import { defaultPurchasePackFor, wholePacksFor } from "@/lib/purchasing/packs";

interface POItemForm extends PurchaseOrderItemFormData {
  id: string;
  pr_item_id?: string;
  raw_material_name?: string;
  raw_material_unit?: string;
  requested_qty?: number;
  requested_satuan_id?: string;
  source?: "manual" | "pr" | "prefill";
  subtotal: number;
}

type SuppliersResponse = Supplier[] | { data?: Supplier[] };
type FetchError = Error & {
  response?: Response;
};

function mapPOItemToForm(item: PurchaseOrderItem): POItemForm {
  const row = item as PurchaseOrderItem & {
    pr_item_id?: string | null;
    satuan_id?: string | null;
    catatan?: string | null;
  };
  const rawMaterial = item.raw_material;
  const satuan = item.satuan;
  const qty = Number(item.qty_ordered || 0);
  const price = Number(item.harga_satuan || 0);
  const note = row.catatan ?? item.notes ?? "";

  return {
    id: item.id,
    pr_item_id: row.pr_item_id || undefined,
    raw_material_id: item.raw_material_id || "",
    satuan_id: row.satuan_id || undefined,
    qty_ordered: qty,
    harga_satuan: price,
    notes: note,
    subtotal: qty * price,
    raw_material_name: rawMaterial?.nama || note,
    raw_material_unit: satuan?.nama || rawMaterial?.satuan || "",
    requested_qty: qty,
    requested_satuan_id: row.satuan_id || undefined,
    source: row.pr_item_id ? "pr" : "manual",
  };
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

type UnitOption = { value: string; label: string; description?: string };

function resolveSatuanIdFromPrItem(
  item: {
    satuan_id?: string | null;
    satuan?: { id?: string; nama?: string } | null;
    unit?: string | null;
    raw_material_id?: string | null;
  },
  materials: RawMaterialWithStock[],
  units: Unit[]
): string | undefined {
  if (item.satuan_id) return item.satuan_id;
  if (item.satuan?.id) return item.satuan.id;

  const label = (item.satuan?.nama || item.unit || "").trim();
  if (label) {
    const normalized = label.toLowerCase();
    const match = units.find(
      (unit) =>
        unit.nama.toLowerCase() === normalized ||
        unit.kode?.toLowerCase() === normalized
    );
    if (match) return match.id;
  }

  if (item.raw_material_id) {
    const material = materials.find((entry) => entry.id === item.raw_material_id);
    return material?.satuan_besar_id || undefined;
  }

  return undefined;
}

function buildMaterialUnitOptions(
  materialId: string | undefined,
  materials: RawMaterialWithStock[],
  units: Unit[],
  selected?: { unitId?: string; unitName?: string }
): UnitOption[] {
  const material = materials.find((entry) => entry.id === materialId);
  const conversionUnitIds = (material?.unit_conversions || [])
    .filter((conversion) => conversion.is_active !== false)
    .map((conversion) => conversion.satuan_id);
  const unitIds = Array.from(
    new Set([
      material?.satuan_besar_id,
      material?.satuan_kecil_id,
      selected?.unitId,
      ...conversionUnitIds,
    ].filter(Boolean) as string[])
  );

  const options = unitIds
    .map((unitId) => {
      const unit = units.find((entry) => entry.id === unitId);
      if (unit) {
        return { value: unit.id, label: unit.nama, description: unit.kode };
      }
      if (unitId === selected?.unitId && selected.unitName) {
        return { value: unitId, label: selected.unitName };
      }
      return null;
    })
    .filter(Boolean) as UnitOption[];

  if (selected?.unitId && !options.some((option) => option.value === selected.unitId)) {
    const unit = units.find((entry) => entry.id === selected.unitId);
    options.push({
      value: selected.unitId,
      label: unit?.nama || selected.unitName || "Satuan",
      description: unit?.kode,
    });
  }

  return options;
}

interface PRForPO {
  id: string;
  pr_number: string;
  status: string;
  converted_po_id?: string | null;
  department?: { name: string };
  requester_name?: string;
  department_name?: string;
  items?: Array<{
    id: string;
    pr_id?: string;
    raw_material_id?: string | null;
    satuan_id?: string | null;
    description: string;
    qty: number;
    unit: string;
    estimated_price: number;
    raw_material?: { id: string; kode: string; nama: string; satuan?: string };
    satuan?: { id: string; nama: string };
  }>;
}

type NewPOPageProps = {
  poId?: string;
};

export function NewPOPage({ poId }: NewPOPageProps = {}) {
  const isEditMode = Boolean(poId);
  const router = useRouter();
  const searchParams = useSearchParams();
  const formDataQuery = usePOFormData();
  const detailQuery = usePurchaseOrder(poId || "");
  const existingPo = detailQuery.data ?? null;
  const suppliers = formDataQuery.data?.suppliers ?? [];
  const materials = formDataQuery.data?.materials ?? [];
  const units = formDataQuery.data?.units ?? [];
  const [selectedPR, setSelectedPR] = useState<PRForPO | null>(null);
  const [loadingPR, setLoadingPR] = useState(false);
  const [editPrefillDone, setEditPrefillDone] = useState(!poId);
  const [isSaving, setIsSaving] = useState(false);
  const loading = formDataQuery.isLoading || (isEditMode && (detailQuery.isLoading || !editPrefillDone));
  const createMutation = useCreatePurchaseOrder();
  const isSubmitting = createMutation.isPending || isSaving;
  const prId = isEditMode ? null : searchParams.get("pr_id");
  const [formData, setFormData] = useState<PurchaseOrderFormData>({
    supplier_id: "",
    pr_id: prId || undefined,
    tanggal_po: new Date().toISOString().split("T")[0],
    tanggal_kirim_estimasi: "",
    catatan: "",
    alamat_pengiriman: "",
    diskon_persen: 0,
    diskon_nominal: 0,
    ppn_persen: 11,
    source_type: "manual",
    production_order_id: null,
    source_reference: null,
    items: [],
  });
  const [items, setItems] = useState<POItemForm[]>([]);
  const itemsStructureLocked = isEditMode || Boolean(formData.pr_id || selectedPR);
  const itemsQtyLocked = isEditMode;
  const canCreateFromPr = isEditMode || Boolean(prId);

  const getUnitName = useCallback((unitId?: string) => {
    return units.find((unit) => unit.id === unitId)?.nama || "";
  }, [units]);

  const getMaterialUnitOptions = useCallback((
    materialId?: string,
    selected?: { unitId?: string; unitName?: string }
  ) => buildMaterialUnitOptions(materialId, materials, units, selected), [materials, units]);

  /**
   * Buying prices come from the last GRN cost for the material, so the item keeps
   * its own unit and only the price is filled in.
   */
  const applyPurchasePriceToItem = useCallback(async (
    item: POItemForm,
    supplierId: string,
    unitId?: string
  ): Promise<POItemForm> => {
    if (!item.raw_material_id) return item;

    const material = materials.find((entry) => entry.id === item.raw_material_id);
    const targetUnitId =
      unitId || item.satuan_id || item.requested_satuan_id || material?.satuan_besar_id || undefined;
    if (!targetUnitId) return item;

    try {
      const suggestion = await getRawMaterialPurchasePrice(item.raw_material_id, {
        supplierId,
        satuanId: targetUnitId,
      });
      if (!suggestion || suggestion.unit_price <= 0) return item;

      const unitPrice = Math.round(suggestion.unit_price);
      const qty = Math.max(1, Number(item.qty_ordered || item.requested_qty || 1));

      return {
        ...item,
        satuan_id: targetUnitId,
        raw_material_unit: getUnitName(targetUnitId) || item.raw_material_unit,
        qty_ordered: qty,
        harga_satuan: unitPrice,
        subtotal: qty * unitPrice,
      };
    } catch (error) {
      console.error("Error applying purchase price:", error);
      return item;
    }
  }, [getUnitName, materials]);

  const applySupplierPrices = useCallback(async (supplierId: string, nextItems = items) => {
    if (!supplierId || nextItems.length === 0) return nextItems;
    const pricedItems = await Promise.all(nextItems.map((item) => applyPurchasePriceToItem(item, supplierId)));
    setItems(pricedItems);
    return pricedItems;
  }, [applyPurchasePriceToItem, items]);

  const applySupplierPricesForItems = useCallback(async (supplierId: string, nextItems: POItemForm[]) => {
    if (!supplierId || nextItems.length === 0) return nextItems;
    const pricedItems = await Promise.all(nextItems.map((item) => applyPurchasePriceToItem(item, supplierId)));
    setItems(pricedItems);
    return pricedItems;
  }, [applyPurchasePriceToItem]);

  // Auto-fill from approved purchase request (?pr_id=)
  const loadPRForPO = useCallback(async (id: string) => {
    setLoadingPR(true);
    try {
      const pr = await getPurchaseRequest(id);

      if (pr.status !== "approved" || pr.converted_po_id) {
        toast.error("Purchase request belum disetujui atau sudah memiliki purchase order");
        setSelectedPR(null);
        return;
      }

      setSelectedPR(pr as PRForPO);
      setFormData((prev) => ({ ...prev, pr_id: id }));
      const mappedItems: POItemForm[] = (pr.items || []).map((item) => {
        const qty = Number(item.qty || 0);
        const price = Number(item.estimated_price || 0);
        const satuanId = resolveSatuanIdFromPrItem(item, materials, units);
        const unitName =
          item.satuan?.nama ||
          item.unit ||
          units.find((unit) => unit.id === satuanId)?.nama ||
          "";
        return {
          id: item.id,
          pr_item_id: item.id,
          raw_material_id: item.raw_material_id || "",
          satuan_id: satuanId,
          qty_ordered: qty,
          harga_satuan: price,
          notes: item.description || "",
          subtotal: qty * price,
          raw_material_name: item.raw_material?.nama || item.description || "",
          raw_material_unit: unitName,
          requested_qty: qty,
          requested_satuan_id: satuanId,
          source: "pr" as const,
        };
      });
      if (formData.supplier_id) {
        await applySupplierPricesForItems(formData.supplier_id, mappedItems);
      } else {
        setItems(mappedItems);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Kesalahan tidak diketahui";
      console.error("Error loading PR:", error);
      toast.error(message || "Gagal memuat purchase request");
    } finally {
      setLoadingPR(false);
    }
  }, [applySupplierPricesForItems, formData.supplier_id, materials, units]);

  useEffect(() => {
    if (isEditMode) return;
    if (!prId) return;
    if (formDataQuery.isLoading || units.length === 0) return;
    loadPRForPO(prId);
  }, [isEditMode, loadPRForPO, prId, formDataQuery.isLoading, units.length]);

  useEffect(() => {
    if (!isEditMode || !existingPo || editPrefillDone) return;

    const normalizedStatus = String(existingPo.status || "").toLowerCase();
    if (normalizedStatus !== "draft") {
      toast.error("PO hanya bisa diedit saat status draft");
      router.replace(`/dashboard/purchasing/po/${poId}`);
      return;
    }

    setFormData({
      supplier_id: existingPo.supplier_id || "",
      pr_id: existingPo.pr_id || undefined,
      tanggal_po: existingPo.tanggal_po?.split("T")[0] || new Date().toISOString().split("T")[0],
      tanggal_kirim_estimasi: existingPo.tanggal_kirim_estimasi?.split("T")[0] || "",
      catatan: existingPo.catatan || "",
      alamat_pengiriman: existingPo.alamat_pengiriman || "",
      diskon_persen: Number(existingPo.diskon_persen || 0),
      diskon_nominal: Number(existingPo.diskon_nominal || 0),
      ppn_persen: Number(existingPo.ppn_persen ?? 11),
      source_type: existingPo.source_type || "manual",
      production_order_id: existingPo.production_order_id || null,
      source_reference: existingPo.source_reference || null,
      items: [],
    });

    const mappedItems = (existingPo.items || []).map(mapPOItemToForm);
    setItems(mappedItems);
    if (existingPo.pr_id) {
      setSelectedPR({
        id: existingPo.pr_id,
        pr_number: "Purchase Request terkait",
        status: "converted",
      });
    }
    setEditPrefillDone(true);
  }, [isEditMode, existingPo, editPrefillDone, poId, router]);

  useEffect(() => {
    if (formDataQuery.isError) {
      toast.error(`Gagal memuat data: ${getErrorMessage(formDataQuery.error, "Kesalahan tidak diketahui")}`);
    }
  }, [formDataQuery.isError, formDataQuery.error]);

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const applyUnitPriceForItem = useCallback(async (item: POItemForm, supplierId: string, unitId?: string) => {
    if (!supplierId || !item.raw_material_id || !unitId) return item;
    return applyPurchasePriceToItem(item, supplierId, unitId);
  }, [applyPurchasePriceToItem]);

  const updateItem = (index: number, field: keyof POItemForm, value: POItemForm[keyof POItemForm]) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };

    // Recalculate subtotal
    if (field === "qty_ordered" || field === "harga_satuan") {
      const qty = Number(field === "qty_ordered" ? value : newItems[index].qty_ordered);
      const price = Number(field === "harga_satuan" ? value : newItems[index].harga_satuan);
      newItems[index].subtotal = qty * price;
      if (field === "qty_ordered") {
        newItems[index].requested_qty = qty;
      }
    }

    if (field === "satuan_id") {
      newItems[index].requested_satuan_id = String(value || "");
      newItems[index].raw_material_unit = getUnitName(String(value || "")) || newItems[index].raw_material_unit;
    }

    // Update material info
    if (field === "raw_material_id") {
      const material = materials.find((m) => m.id === value);
      const unitId = (material && defaultPurchasePackFor(material)?.satuan_id) || material?.satuan_besar_id || "";
      newItems[index].raw_material_name = material?.nama;
      newItems[index].raw_material_unit = getUnitName(unitId) || material?.satuan_besar_nama || material?.satuan;
      newItems[index].satuan_id = unitId || undefined;
      newItems[index].requested_satuan_id = unitId || undefined;
    }

    setItems(newItems);

    if (field === "raw_material_id" && formData.supplier_id && String(value)) {
      applyPurchasePriceToItem(newItems[index], formData.supplier_id).then((pricedItem) => {
        setItems((current) => current.map((item, itemIndex) => itemIndex === index ? pricedItem : item));
      });
    }

    if (field === "satuan_id" && formData.supplier_id && String(value)) {
      applyUnitPriceForItem(newItems[index], formData.supplier_id, String(value)).then((pricedItem) => {
        setItems((current) => current.map((item, itemIndex) => itemIndex === index ? pricedItem : item));
      });
    }
  };

  const calculateTotals = () => {
    const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
    const diskonNominal = formData.diskon_persen
      ? (subtotal * formData.diskon_persen) / 100
      : formData.diskon_nominal || 0;
    const afterDiskon = subtotal - diskonNominal;
    const ppnNominal = (afterDiskon * (formData.ppn_persen || 11)) / 100;
    const total = afterDiskon + ppnNominal;

    return { subtotal, diskonNominal, ppnNominal, total };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEditMode && !formData.pr_id) {
      toast.error("Purchase order harus dibuat dari purchase request yang disetujui");
      return;
    }
    if (!formData.supplier_id) {
      toast.error("Pilih supplier terlebih dahulu");
      return;
    }
    if (items.length === 0) {
      toast.error("Tambahkan minimal 1 item");
      return;
    }
    const invalidItem = items.find((item) => !item.raw_material_id || item.qty_ordered <= 0 || item.harga_satuan < 0);
    if (invalidItem) {
      toast.error("Lengkapi bahan baku, jumlah, dan harga untuk semua item");
      return;
    }

    try {
      if (isEditMode && poId) {
        setIsSaving(true);

        await updatePurchaseOrder(poId, {
          supplier_id: formData.supplier_id,
          tanggal_po: formData.tanggal_po,
          tanggal_kirim_estimasi: formData.tanggal_kirim_estimasi || undefined,
          catatan: formData.catatan || undefined,
          alamat_pengiriman: formData.alamat_pengiriman || undefined,
          diskon_persen: formData.diskon_persen,
          diskon_nominal: formData.diskon_nominal,
          ppn_persen: formData.ppn_persen,
        });

        toast.success("PO berhasil disubmit");
        router.push(`/dashboard/purchasing/po/${poId}?updated=1`);
        return;
      }

      const payload: PurchaseOrderFormData = {
        ...formData,
        pr_id: formData.pr_id || undefined,
        tanggal_kirim_estimasi: formData.tanggal_kirim_estimasi || "",
        items: items.map((item) => ({
          raw_material_id: item.raw_material_id,
          pr_item_id: item.pr_item_id,
          satuan_id: item.satuan_id,
          qty_ordered: Number(item.qty_ordered || 0),
          harga_satuan: Number(item.harga_satuan || 0),
          notes: item.notes || "",
        })),
      };
      const po = await createMutation.mutateAsync(payload);

      toast.success("PO berhasil dibuat");
      router.push(`/dashboard/purchasing/po/${po.id}`);
    } catch (error: unknown) {
      const typedError = error as FetchError;
      console.error(isEditMode ? "Error updating PO:" : "Error creating PO:", error);

      if (typedError.response) {
        try {
          const errorData = await typedError.response.json();
          if (errorData.errors && Object.keys(errorData.errors).length > 0) {
            const errorMessages = Object.entries(errorData.errors)
              .map(([field, messages]) => `${field}: ${(messages as string[]).join(", ")}`)
              .join("\n");
            toast.error(`Validasi gagal:\n${errorMessages}`);
          } else {
            toast.error(errorData.message || (isEditMode ? "Gagal memperbarui purchase order" : "Gagal membuat purchase order"));
          }
        } catch {
          toast.error(isEditMode ? "Gagal memperbarui purchase order" : "Gagal membuat purchase order");
        }
      } else {
        toast.error(getErrorMessage(error, isEditMode ? "Gagal memperbarui purchase order" : "Gagal membuat purchase order"));
      }
    } finally {
      setIsSaving(false);
    }
  };

  const { subtotal, diskonNominal, ppnNominal, total } = calculateTotals();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-gray-500">
        Memuat formulir purchase order...
      </div>
    );
  }

  if (!canCreateFromPr) {
    const reorderMaterial = materials.find((m) => m.id === searchParams.get("material_id"));
    const reorderBaseQty = Number(searchParams.get("qty")) || 0;
    const reorderPack = reorderMaterial ? defaultPurchasePackFor(reorderMaterial) : undefined;
    const reorderPackQty = wholePacksFor(reorderBaseQty, reorderPack?.qty_in_base_unit ?? 1);
    const reorderPrHref = reorderMaterial
      ? `/dashboard/purchasing/pr/insert?${new URLSearchParams({
          material_id: reorderMaterial.id,
          qty: String(reorderBaseQty),
        }).toString()}`
      : null;
    return (
      <div className="space-y-6">
        <PurchasingFormHeader
          backHref={RM_ROUTES.purchasingPo}
          title="Buat Purchase Order"
          description="Purchase order hanya bisa dibuat dari purchase request yang sudah disetujui"
        />

        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="flex flex-col items-center gap-4 px-6 py-14 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-pink-50 text-pink-600">
              <ClipboardList className="h-6 w-6" />
            </div>
            {reorderMaterial && reorderPackQty > 0 && (
              <div className="w-full max-w-md rounded-xl bg-muted px-4 py-3 text-left text-sm">
                <p className="font-medium text-gray-900">Saran pemesanan ulang dari laporan stok rendah</p>
                <p className="mt-1 text-gray-600">
                  {reorderMaterial.nama}: {reorderPackQty} {getUnitName(reorderPack?.satuan_id) || reorderMaterial.satuan_besar_nama}
                  {" "}({reorderBaseQty} satuan dasar)
                </p>
              </div>
            )}
            <div className="space-y-2">
              <h2 className="text-lg font-semibold text-gray-900">Mulai dari Purchase Request</h2>
              <p className="max-w-md text-sm text-gray-500">
                Buka purchase request yang sudah disetujui lalu gunakan &quot;Buat Purchase Order&quot; untuk memulai PO baru.
                Pembuatan purchase order secara langsung tidak tersedia di halaman ini.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Link href={RM_ROUTES.purchasingPo}>
                <Button variant="outline" className="h-10 w-full sm:w-auto">
                  Kembali ke Purchase Order
                </Button>
              </Link>
              <Link href={reorderPrHref ?? RM_ROUTES.purchasingPr}>
                <Button className="h-10 w-full bg-pink-600 hover:bg-pink-700 sm:w-auto">
                  {reorderPrHref ? "Buat Purchase Request" : "Buka Purchase Request"}
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={isEditMode && poId ? RM_ROUTES.purchasingPoDetail(poId) : RM_ROUTES.purchasingPo}
        title={isEditMode ? `Ubah ${existingPo?.nomor_po || "Purchase Order"}` : "Buat Purchase Order"}
        description={
          isEditMode
            ? "Perbarui informasi purchase order draf. Item tidak dapat diubah."
            : selectedPR
              ? `Dari purchase request ${selectedPR.pr_number} — qty dan harga masih bisa disesuaikan sebelum disimpan`
              : "Memuat detail purchase request..."
        }
      />

      {!isEditMode && selectedPR && (
      <Card className="border-gray-200/70 shadow-xs">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Sumber Purchase Request</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{selectedPR.pr_number}</span>
                  <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                    {selectedPR.status}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {selectedPR.department_name || selectedPR.department?.name || "-"} · {selectedPR.items?.length || 0} item
                </p>
              </div>
              <Button type="button" variant="outline" onClick={() => router.push(RM_ROUTES.purchasingPrDetail(selectedPR.id))}>
                Lihat Purchase Request
              </Button>
            </div>
        </CardContent>
      </Card>
      )}

      {isEditMode && formData.pr_id && selectedPR && (
        <Card className="border-gray-200/70 shadow-xs">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Sumber Purchase Request</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{selectedPR.pr_number}</span>
                <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">Purchase Request</Badge>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push(RM_ROUTES.purchasingPrDetail(selectedPR.id))}
              >
                Lihat Purchase Request
              </Button>
            </div>
          </CardContent>
        </Card>
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
                  options={suppliers.map((supplier) => ({
                    value: supplier.id,
                    label: supplier.nama_supplier,
                    description: supplier.kode_supplier,
                  }))}
                  value={formData.supplier_id}
                  onChange={(value) => {
                    setFormData((prev) => ({ ...prev, supplier_id: value }));
                    if (value) {
                      applySupplierPrices(value);
                    }
                  }}
                  placeholder="Pilih supplier..."
                  searchPlaceholder="Cari supplier..."
                  emptyMessage="Supplier tidak ditemukan"
                  allowClear
                  disabled={loading}
                  className="w-full! h-9 text-sm"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <DsDateTimePicker
                  label="Tanggal PO"
                  value={formData.tanggal_po}
                  onChange={(value) => setFormData((prev) => ({ ...prev, tanggal_po: value }))}
                  placeholder="Pilih tanggal PO..."
                  dateOnly
                />
                <DsDateTimePicker
                  label="Estimasi Tanggal Pengiriman"
                  value={formData.tanggal_kirim_estimasi}
                  onChange={(value) =>
                    setFormData((prev) => ({ ...prev, tanggal_kirim_estimasi: value }))
                  }
                  placeholder="Pilih estimasi tanggal pengiriman..."
                  dateOnly
                />
              </div>

              <div className="min-w-0 space-y-1.5">
                <Label className="text-xs">Catatan</Label>
                <Textarea
                  value={formData.catatan}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, catatan: e.target.value }))
                  }
                  placeholder="Catatan untuk supplier..."
                  rows={2}
                  className="resize-none text-sm"
                />
              </div>

              <div className="min-w-0 space-y-1.5">
                <Label className="text-xs">Alamat Pengiriman</Label>
                <Textarea
                  value={formData.alamat_pengiriman}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      alamat_pengiriman: e.target.value,
                    })
                  }
                  placeholder="Alamat pengiriman..."
                  rows={2}
                  className="resize-none text-sm"
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-gray-200/70 shadow-xs xl:col-span-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Ringkasan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Subtotal</span>
                <span className="font-medium text-gray-900">
                  {formatAmount(subtotal)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Diskon</span>
                <span className="font-medium text-gray-900">
                  {formatAmount(diskonNominal)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">PPN ({formData.ppn_persen}%)</span>
                <span className="font-medium text-gray-900">
                  {formatAmount(ppnNominal)}
                </span>
              </div>
              <div className="flex justify-between border-t border-gray-200/70 pt-3 text-lg font-semibold text-gray-900">
                <span>Total</span>
                <span>{formatAmount(total)}</span>
              </div>

              <div className="grid grid-cols-1 gap-3 border-t border-gray-200/70 pt-4 sm:grid-cols-2 xl:grid-cols-1">
                <div className="min-w-0 space-y-1.5">
                  <Label className="text-xs">Diskon (%)</Label>
                  <div className="flex rounded-lg border border-gray-200/80 bg-white focus-within:border-gray-300 focus-within:ring-1 focus-within:ring-gray-200">
                    <NumericInput
                      min="0"
                      max="100"
                      value={formData.diskon_persen}
                      decimalScale={2}
                      onValueChange={(value) =>
                        setFormData({
                          ...formData,
                          diskon_persen: Math.min(100, Math.max(0, value || 0)),
                          diskon_nominal: 0,
                        })
                      }
                      className="h-9 rounded-r-none border-0 text-sm shadow-none focus-visible:ring-0"
                    />
                    <div className="flex min-w-10 items-center justify-center rounded-r-lg border-l border-gray-200/80 bg-gray-50 px-3 text-xs font-medium text-gray-500">
                      %
                    </div>
                  </div>
                </div>
                <div className="min-w-0 space-y-1.5">
                  <Label className="text-xs">PPN (%)</Label>
                  <div className="flex rounded-lg border border-gray-200/80 bg-white focus-within:border-gray-300 focus-within:ring-1 focus-within:ring-gray-200">
                    <NumericInput
                      min="0"
                      max="100"
                      value={formData.ppn_persen}
                      decimalScale={2}
                      onValueChange={(value) =>
                        setFormData({
                          ...formData,
                          ppn_persen: Math.min(100, Math.max(0, value || 0)),
                        })
                      }
                      className="h-9 rounded-r-none border-0 text-sm shadow-none focus-visible:ring-0"
                    />
                    <div className="flex min-w-10 items-center justify-center rounded-r-lg border-l border-gray-200/80 bg-gray-50 px-3 text-xs font-medium text-gray-500">
                      %
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-gray-200/70 shadow-xs">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Item Purchase Order</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {items.map((item, index) => (
              <div
                key={item.id}
                className="rounded-xl border border-gray-200/70 bg-white/70 p-4"
              >
                <div className="mb-4 flex items-center justify-between border-b border-gray-200/70 pb-3">
                  <p className="text-sm font-medium text-gray-900">Item #{index + 1}</p>
                  {!itemsStructureLocked && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeItem(index)}
                      className="h-8 text-red-500 hover:text-red-600"
                    >
                      <Trash2 className="mr-1 h-4 w-4" />
                      Hapus
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                  <div className="min-w-0 space-y-1.5 lg:col-span-4">
                    <Label className="text-xs">
                      Bahan Baku <span className="text-red-500">*</span>
                    </Label>
                    <Combobox
                      options={materials.map((m) => ({
                        value: m.id,
                        label: m.nama,
                        description: m.kode,
                      }))}
                      value={item.raw_material_id}
                      onChange={(v) => updateItem(index, "raw_material_id", v)}
                      placeholder="Pilih bahan baku..."
                      searchPlaceholder="Cari bahan baku (nama/kode)..."
                      emptyMessage="Bahan baku tidak ditemukan"
                      allowClear
                      disabled={loading || itemsStructureLocked}
                      className="w-full! h-9 text-sm"
                    />
                  </div>

                  <div className="min-w-0 space-y-1.5 lg:col-span-2">
                    <Label className="text-xs">Qty</Label>
                    <NumericInput
                      min="0"
                      value={item.qty_ordered > 0 ? item.qty_ordered : null}
                      decimalScale={4}
                      placeholder="0"
                      disabled={itemsQtyLocked}
                      onFocus={(event) => event.currentTarget.select()}
                      onValueChange={(value) => updateItem(index, "qty_ordered", value || 0)}
                      className="h-9 text-sm"
                    />
                  </div>

                  <div className="min-w-0 space-y-1.5 lg:col-span-2">
                    <Label className="text-xs">Satuan</Label>
                    <Combobox
                      options={getMaterialUnitOptions(item.raw_material_id, {
                        unitId: item.satuan_id,
                        unitName: item.raw_material_unit,
                      })}
                      value={item.satuan_id || ""}
                      onChange={(value) => updateItem(index, "satuan_id", value || undefined)}
                      placeholder={item.raw_material_id ? "Pilih satuan..." : "Pilih bahan baku dulu"}
                      searchPlaceholder="Cari satuan..."
                      emptyMessage={
                        item.raw_material_id
                          ? "Belum ada satuan untuk bahan baku ini"
                          : "Pilih bahan baku terlebih dahulu"
                      }
                      allowClear={false}
                      disabled={loading || itemsStructureLocked}
                      className="w-full! h-9 text-sm"
                    />
                  </div>

                  <div className="min-w-0 space-y-1.5 lg:col-span-2">
                    <Label className="text-xs">Harga Satuan</Label>
                    <NumericInput
                      min="0"
                      value={item.harga_satuan}
                      decimalScale={0}
                      disabled={itemsQtyLocked}
                      onValueChange={(value) => updateItem(index, "harga_satuan", value || 0)}
                      className="h-9 text-sm"
                    />
                  </div>

                  <div className="min-w-0 rounded-lg bg-gray-50/80 p-3 lg:col-span-2">
                    <p className="text-xs text-gray-500">Subtotal</p>
                    <p className="text-sm font-semibold text-gray-900">
                      {formatAmount(item.subtotal)}
                    </p>
                  </div>
                </div>
              </div>
            ))}

            {items.length === 0 && (
              <div className="rounded-xl border border-gray-200/70 bg-gray-50/60 py-10 text-center text-sm text-gray-500">
                {loadingPR
                  ? "Memuat item purchase request..."
                  : "Belum ada item dari purchase request."}
              </div>
            )}
          </CardContent>
        </Card>

        <PurchasingFormFooter
          onCancel={() =>
            router.push(isEditMode && poId ? RM_ROUTES.purchasingPoDetail(poId) : RM_ROUTES.purchasingPo)
          }
          submitLabel="Simpan"
          loading={isSubmitting}
          disabled={isSubmitting || (!isEditMode && (loadingPR || !selectedPR))}
          formId="purchase-order-form"
        />
      </form>
    </div>
  );
}
