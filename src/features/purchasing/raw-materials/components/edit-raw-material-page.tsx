"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NumericInput } from "@/components/ui/numeric-input";
import { ITEMS_RAW_MATERIALS_PATH } from "@/modules/purchasing/constants/items-nav";
import {
  PurchasingFormFooter,
  PurchasingFormHeader,
} from "@/modules/purchasing/components/page/purchasing-page-header";
import { Loader2, Package, AlertCircle, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { Combobox } from "@/components/ui/combobox";
import { defaultPurchasePackFor } from "@/lib/purchasing/packs";
import type { RawMaterialUnitConversion } from "@/types/purchasing";

function purchasePackFlag(satuanId: string): RawMaterialUnitConversion & { is_purchase_default: boolean } {
  return { satuan_id: satuanId, qty_in_base_unit: 1, is_purchase_default: true };
}
import { RawMaterialWithStock, MaterialCategory } from "@/types/purchasing";
import {
  useRawMaterial,
  useRawMaterialUnits,
  useRawMaterialCategoryOptions,
} from "../queries";
import { useUpdateRawMaterial } from "../mutations";
import { RawMaterialUnitConversionsEditor } from "@/modules/purchasing/components/raw-materials/RawMaterialUnitConversionsEditor";
import { toLookupOptions } from "../master-lookups";
import {
  RawMaterialCoaFields,
  applyCategoryCoaDefaults,
} from "./raw-material-coa-fields";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function formatQuantity(value?: number | null) {
  return Number(value ?? 0).toLocaleString("en-US", { maximumFractionDigits: 4 });
}

export function EditRawMaterialPage() {
  const router = useRouter();
  const params = useParams();
  const materialId = params.id as string;

  const materialQuery = useRawMaterial(materialId);
  const unitsQuery = useRawMaterialUnits();
  const categoriesQuery = useRawMaterialCategoryOptions();
  const updateMutation = useUpdateRawMaterial();
  const material = materialQuery.data ?? null;
  const units = unitsQuery.data ?? [];
  const categoryOptions = toLookupOptions(categoriesQuery.data);
  const loading = materialQuery.isLoading;
  const isSubmitting = updateMutation.isPending;
  const masterLoading = categoriesQuery.isLoading;

  const [formData, setFormData] = useState({
    nama: "",
    kategori: "" as MaterialCategory,
    deskripsi: "",
    satuan_besar_id: "",
    satuan_kecil_id: undefined as string | undefined,
    harga_beli: 0,
    konversi_factor: 1,
    stok_minimum: 0,
    stok_maximum: 0,
    shelf_life_days: undefined as number | undefined,
    coa_production: "",
    coa_rnd: "",
    coa_asset: "",
    unit_conversions: [] as NonNullable<RawMaterialWithStock["unit_conversions"]>,
  });
  // Pack bawaan baris PO baru (item.raw_material_unit_conversions.is_purchase_default).
  const [purchasePackId, setPurchasePackId] = useState("");

  useEffect(() => {
    const data = materialQuery.data;
    if (!data) return;
    setFormData({
      nama: data.nama || "",
      kategori: data.kategori || "",
      deskripsi: data.deskripsi || "",
      satuan_besar_id: data.satuan_besar_id || "",
      satuan_kecil_id: data.satuan_kecil_id || undefined,
      harga_beli: data.harga_beli || 0,
      konversi_factor: data.konversi_factor || 1,
      stok_minimum: data.stok_minimum || 0,
      stok_maximum: data.stok_maximum || 0,
      shelf_life_days: data.shelf_life_days || undefined,
      coa_production: data.coa_production || "",
      coa_rnd: data.coa_rnd || "",
      coa_asset: data.coa_asset || "",
      unit_conversions: (data.unit_conversions || []).filter(
        (conversion) =>
          conversion.satuan_id !== data.satuan_besar_id && conversion.satuan_id !== data.satuan_kecil_id
      ),
    });
    setPurchasePackId(defaultPurchasePackFor(data)?.satuan_id ?? data.satuan_besar_id ?? "");
  }, [materialQuery.data]);

  useEffect(() => {
    if (materialQuery.isError) {
      console.error("Failed to load material:", materialQuery.error);
      toast.error("Gagal memuat bahan baku");
    }
  }, [materialQuery.isError, materialQuery.error]);

  const satuanBesar = units.filter((u) => u.tipe === "BESAR" || u.tipe === "KONVERSI");
  const satuanKecil = units.filter((u) => u.tipe === "KECIL" || u.tipe === "KONVERSI");
  const selectedSatuanBesar = satuanBesar.find((u) => u.id === formData.satuan_besar_id);
  const satuanBesarCode = selectedSatuanBesar?.kode || selectedSatuanBesar?.simbol || "-";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.nama || !formData.kategori) {
      toast.error("Nama bahan dan kategori wajib diisi");
      return;
    }

    try {
      await updateMutation.mutateAsync({
        id: materialId,
        payload: {
          ...formData,
          coa_production: formData.coa_production || null,
          coa_rnd: formData.coa_rnd || null,
          coa_asset: formData.coa_asset || null,
          unit_conversions: [
            ...(formData.unit_conversions || [])
              .filter((conversion) => conversion.satuan_id && conversion.qty_in_base_unit > 0)
              .map((conversion) => ({
                satuan_id: conversion.satuan_id,
                qty_in_base_unit: conversion.qty_in_base_unit,
                is_base: false,
              })),
            // Satuan besar/kecil disintesis ulang oleh API; baris ini hanya membawa flag bawaan.
            ...(purchasePackId ? [purchasePackFlag(purchasePackId)] : []),
          ],
        },
      });
      toast.success("Bahan baku berhasil diperbarui");
      router.push(`${ITEMS_RAW_MATERIALS_PATH}/${materialId}`);
    } catch (error: unknown) {
      console.error("Error updating material:", error);
      toast.error(getErrorMessage(error, "Gagal memperbarui bahan baku"));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-gray-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-pink-600" />
        Memuat bahan baku...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={`${ITEMS_RAW_MATERIALS_PATH}/${materialId}`}
        title="Ubah Bahan Baku"
        description="Perbarui detail bahan baku"
      />

      <form id="edit-raw-material-form" onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="space-y-6 lg:col-span-8">
            <Card className="border-gray-200/70 shadow-xs">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Package className="h-4 w-4" />
                  Informasi Dasar
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="kode" className="text-xs">
                      Kode Bahan
                    </Label>
                    <Input
                      id="kode"
                      value={material?.kode || ""}
                      disabled
                      className="h-9 bg-gray-50 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="kategori" className="text-xs">
                      Kategori <span className="text-red-500">*</span>
                    </Label>
                    <Combobox
                      options={categoryOptions}
                      value={formData.kategori || ""}
                      onChange={(v) => {
                        const kategori = v as MaterialCategory;
                        const coa = applyCategoryCoaDefaults(
                          kategori,
                          {
                            coa_production: formData.coa_production,
                            coa_rnd: formData.coa_rnd,
                            coa_asset: formData.coa_asset,
                          },
                          formData.kategori
                        );
                        setFormData({ ...formData, kategori, ...coa });
                      }}
                      placeholder={masterLoading ? "Memuat kategori..." : "Pilih kategori..."}
                      searchPlaceholder="Cari kategori..."
                      emptyMessage="Kategori tidak ditemukan"
                      allowClear
                      className="h-9 text-sm"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="nama" className="text-xs">
                    Nama Bahan <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="nama"
                    value={formData.nama}
                    onChange={(e) => setFormData({ ...formData, nama: e.target.value })}
                    maxLength={100}
                    required
                    className="h-9 text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="deskripsi" className="text-xs">
                    Deskripsi
                  </Label>
                  <Textarea
                    id="deskripsi"
                    value={formData.deskripsi}
                    onChange={(e) => setFormData({ ...formData, deskripsi: e.target.value })}
                    placeholder="Deskripsi tambahan..."
                    rows={2}
                    className="resize-none text-sm"
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="border-gray-200/70 shadow-xs">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Package className="h-4 w-4" />
                  Satuan
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="satuan_besar" className="text-xs">
                    Satuan Besar <span className="text-red-500">*</span>
                  </Label>
                  <Combobox
                    options={satuanBesar.map((u) => ({ value: u.id, label: u.nama, description: u.simbol }))}
                    value={formData.satuan_besar_id}
                    onChange={(v) => setFormData({ ...formData, satuan_besar_id: v })}
                    placeholder="Pilih satuan..."
                    searchPlaceholder="Cari..."
                    emptyMessage="Satuan tidak ditemukan"
                    allowClear
                    className="h-9 text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="satuan_kecil" className="text-xs">
                    Satuan Kecil
                  </Label>
                  <Combobox
                    options={[
                      { value: "", label: "Tidak ada", description: "Tanpa satuan kecil" },
                      ...satuanKecil.map((u) => ({ value: u.id, label: u.nama, description: u.simbol })),
                    ]}
                    value={formData.satuan_kecil_id || ""}
                    onChange={(v) => setFormData({ ...formData, satuan_kecil_id: v || undefined })}
                    placeholder="Opsional..."
                    searchPlaceholder="Cari..."
                    emptyMessage="Satuan tidak ditemukan"
                    allowClear
                    className="h-9 text-sm"
                  />
                </div>

                {formData.satuan_kecil_id && (
                  <div className="space-y-1.5">
                    <Label htmlFor="konversi" className="text-xs">
                      Faktor Konversi
                    </Label>
                    <NumericInput
                      id="konversi"
                      min="0"
                      value={formData.konversi_factor}
                      onValueChange={(value) => setFormData({ ...formData, konversi_factor: value || 1 })}
                      decimalScale={4}
                      className="h-9 text-sm"
                    />
                    <p className="text-xs text-gray-500">
                      1 {satuanBesar.find((u) => u.id === formData.satuan_besar_id)?.nama} ={" "}
                      {formatQuantity(formData.konversi_factor)}{" "}
                      {satuanKecil.find((u) => u.id === formData.satuan_kecil_id)?.nama}
                    </p>
                  </div>
                )}

                <RawMaterialUnitConversionsEditor
                  units={units}
                  baseUnitId={formData.satuan_kecil_id || formData.satuan_besar_id}
                  bigUnitId={formData.satuan_besar_id}
                  bigUnitFactor={formData.satuan_kecil_id ? formData.konversi_factor : 1}
                  conversions={(formData.unit_conversions || []).filter(
                    (conversion) =>
                      conversion.satuan_id !== formData.satuan_besar_id &&
                      conversion.satuan_id !== formData.satuan_kecil_id
                  )}
                  onChange={(unit_conversions) => setFormData({ ...formData, unit_conversions })}
                />

                <div className="space-y-1.5">
                  <Label className="text-sm">Pack bawaan pembelian</Label>
                  <Combobox
                    options={Array.from(
                      new Set(
                        [
                          formData.satuan_besar_id,
                          formData.satuan_kecil_id,
                          ...(formData.unit_conversions || []).map((conversion) => conversion.satuan_id),
                        ].filter(Boolean) as string[]
                      )
                    ).map((unitId) => ({ value: unitId, label: units.find((u) => u.id === unitId)?.nama || unitId }))}
                    value={purchasePackId}
                    onChange={setPurchasePackId}
                    placeholder="Pilih pack untuk baris PO baru"
                  />
                  <p className="text-xs text-gray-500">
                    Baris purchase order baru memakai pack ini; GRN mengonversi qty-nya ke satuan dasar stok.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="border-gray-200/70 shadow-xs lg:col-span-4">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertCircle className="h-4 w-4" />
                Pengaturan Stok
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="stok_minimum" className="text-xs">
                    Stok Minimum
                  </Label>
                  <div className="flex rounded-lg border border-gray-200/70 bg-white focus-within:border-pink-300 focus-within:ring-2 focus-within:ring-pink-100">
                    <NumericInput
                      id="stok_minimum"
                      value={formData.stok_minimum}
                      onValueChange={(value) => setFormData({ ...formData, stok_minimum: value })}
                      decimalScale={4}
                      className="h-9 rounded-r-none border-0 text-sm shadow-none focus-visible:ring-0"
                    />
                    <div className="flex min-w-14 items-center justify-center rounded-r-lg border-l border-gray-200/70 bg-gray-50 px-3 text-xs font-semibold uppercase text-gray-500">
                      {satuanBesarCode}
                    </div>
                  </div>
                  <p className="text-xs text-gray-500">
                    Peringatan saat stok satuan besar berada di nilai ini atau kurang
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="stok_maximum" className="text-xs">
                    Stok Maksimum
                  </Label>
                  <div className="flex rounded-lg border border-gray-200/70 bg-white focus-within:border-pink-300 focus-within:ring-2 focus-within:ring-pink-100">
                    <NumericInput
                      id="stok_maximum"
                      value={formData.stok_maximum}
                      onValueChange={(value) => setFormData({ ...formData, stok_maximum: value })}
                      decimalScale={4}
                      className="h-9 rounded-r-none border-0 text-sm shadow-none focus-visible:ring-0"
                    />
                    <div className="flex min-w-14 items-center justify-center rounded-r-lg border-l border-gray-200/70 bg-gray-50 px-3 text-xs font-semibold uppercase text-gray-500">
                      {satuanBesarCode}
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="harga_beli" className="text-xs">
                  Harga Beli
                </Label>
                <div className="flex rounded-lg border border-gray-200/70 bg-white focus-within:border-pink-300 focus-within:ring-2 focus-within:ring-pink-100">
                  <NumericInput
                    id="harga_beli"
                    value={formData.harga_beli}
                    onValueChange={(value) => setFormData({ ...formData, harga_beli: value })}
                    decimalScale={0}
                    className="h-9 rounded-none border-0 text-sm font-mono shadow-none focus-visible:ring-0"
                  />
                  <div className="flex min-w-16 items-center justify-center rounded-r-lg border-l border-gray-200/70 bg-gray-50 px-3 text-xs font-semibold uppercase text-gray-500">
                    /{satuanBesarCode}
                  </div>
                </div>
                <p className="text-xs text-gray-500">
                  Harga beli acuan per satuan besar (dipakai sebelum ada penerimaan barang)
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="shelf_life" className="text-xs">
                  Masa Simpan (hari)
                </Label>
                <Input
                  id="shelf_life"
                  type="number"
                  min="0"
                  value={formData.shelf_life_days || ""}
                  onChange={(e) =>
                    setFormData({ ...formData, shelf_life_days: parseInt(e.target.value, 10) || undefined })
                  }
                  placeholder="Opsional"
                  className="h-9 text-sm"
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-gray-200/70 shadow-xs">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpen className="h-4 w-4" />
              Chart of Accounts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <RawMaterialCoaFields
              value={{
                coa_production: formData.coa_production,
                coa_rnd: formData.coa_rnd,
                coa_asset: formData.coa_asset,
              }}
              onChange={(coa) => setFormData({ ...formData, ...coa })}
              kategori={formData.kategori}
              disabled={isSubmitting}
            />
          </CardContent>
        </Card>

        <PurchasingFormFooter
          formId="edit-raw-material-form"
          onCancel={() => router.back()}
          submitLabel="Simpan Perubahan"
          loading={isSubmitting}
        />
      </form>
    </div>
  );
}
