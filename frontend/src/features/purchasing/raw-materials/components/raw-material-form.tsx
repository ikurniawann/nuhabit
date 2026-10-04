"use client";

import { useState } from "react";
import { AlertCircle, BookOpen, Package } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumericInput } from "@/components/ui/numeric-input";
import { Textarea } from "@/components/ui/textarea";
import { PurchasingFormFooter } from "@/features/purchasing/components/shared/purchasing-page-header";
import { formatNumber } from "@/lib/format";
import { purchasePackUnitIds, type RawMaterialFormState } from "@/lib/purchasing/raw-material-ui-form";
import { toLookupOptions } from "../master-lookups";
import { useRawMaterialCategoryOptions, useRawMaterialUnits } from "../queries";
import { RawMaterialCoaFields, applyCategoryCoaDefaults } from "./raw-material-coa-fields";
import { RawMaterialUnitConversionsEditor } from "./raw-material-unit-conversions-editor";

interface RawMaterialFormProps {
  mode: "create" | "edit";
  formId: string;
  initial: RawMaterialFormState;
  submitLabel: string;
  submitting: boolean;
  onSubmit: (form: RawMaterialFormState) => void;
  onCancel: () => void;
  /** Hanya mode ubah: pack bawaan baris PO baru. */
  purchasePackId?: string;
  onPurchasePackChange?: (unitId: string) => void;
}

/** Form bahan baku bersama untuk halaman tambah dan ubah. */
export function RawMaterialForm({
  mode,
  formId,
  initial,
  submitLabel,
  submitting,
  onSubmit,
  onCancel,
  purchasePackId,
  onPurchasePackChange,
}: RawMaterialFormProps) {
  const unitsQuery = useRawMaterialUnits();
  const categoriesQuery = useRawMaterialCategoryOptions();
  const units = unitsQuery.data ?? [];
  const categoryOptions = toLookupOptions(categoriesQuery.data);
  const masterLoading = categoriesQuery.isLoading;

  const [formData, setFormData] = useState(initial);
  const update = (patch: Partial<RawMaterialFormState>) => setFormData((prev) => ({ ...prev, ...patch }));

  const satuanBesar = units.filter((u) => u.tipe === "BESAR" || u.tipe === "KONVERSI");
  const satuanKecil = units.filter((u) => u.tipe === "KECIL" || u.tipe === "KONVERSI");
  const selectedSatuanBesar = satuanBesar.find((u) => u.id === formData.satuan_besar_id);
  const satuanBesarCode = selectedSatuanBesar?.kode || selectedSatuanBesar?.simbol || "-";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form id={formId} onSubmit={handleSubmit} className="space-y-6">
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
                  {mode === "edit" ? (
                    <Input id="kode" value={formData.kode} disabled className="h-9 bg-gray-50 text-sm" />
                  ) : (
                    <Input
                      id="kode"
                      value={formData.kode}
                      onChange={(e) => update({ kode: e.target.value })}
                      placeholder="Dibuat otomatis jika kosong"
                      maxLength={20}
                      className="h-9 text-sm"
                    />
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="kategori" className="text-xs">
                    Kategori <span className="text-red-500">*</span>
                  </Label>
                  <Combobox
                    options={categoryOptions}
                    value={formData.kategori || ""}
                    onChange={(v) => {
                      const kategori = v;
                      const coa = applyCategoryCoaDefaults(
                        kategori,
                        {
                          coa_production: formData.coa_production,
                          coa_rnd: formData.coa_rnd,
                          coa_asset: formData.coa_asset,
                        },
                        formData.kategori
                      );
                      update({ kategori, ...coa });
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
                  onChange={(e) => update({ nama: e.target.value })}
                  placeholder={mode === "create" ? "Contoh: Gula Pasir Premium" : undefined}
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
                  onChange={(e) => update({ deskripsi: e.target.value })}
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
                  onChange={(v) => update({ satuan_besar_id: v })}
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
                  onChange={(v) => update({ satuan_kecil_id: v || undefined })}
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
                    onValueChange={(value) => update({ konversi_factor: value || 1 })}
                    decimalScale={4}
                    className="h-9 text-sm"
                  />
                  <p className="text-xs text-gray-500">
                    1 {satuanBesar.find((u) => u.id === formData.satuan_besar_id)?.nama} ={" "}
                    {formatNumber(formData.konversi_factor, 4)}{" "}
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
                onChange={(unit_conversions) => update({ unit_conversions })}
              />

              {onPurchasePackChange ? (
                <div className="space-y-1.5">
                  <Label className="text-sm">Pack bawaan pembelian</Label>
                  <Combobox
                    options={purchasePackUnitIds(formData).map((unitId) => ({
                      value: unitId,
                      label: units.find((u) => u.id === unitId)?.nama || unitId,
                    }))}
                    value={purchasePackId ?? ""}
                    onChange={onPurchasePackChange}
                    placeholder="Pilih pack untuk baris PO baru"
                  />
                  <p className="text-xs text-gray-500">
                    Baris purchase order baru memakai pack ini; GRN mengonversi qty-nya ke satuan dasar stok.
                  </p>
                </div>
              ) : null}
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
                    onValueChange={(value) => update({ stok_minimum: value })}
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
                    onValueChange={(value) => update({ stok_maximum: value })}
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
                  onValueChange={(value) => update({ harga_beli: value })}
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
                  update({ shelf_life_days: parseInt(e.target.value, 10) || undefined })
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
            onChange={(coa) => update({ ...coa })}
            kategori={formData.kategori}
            disabled={submitting}
          />
        </CardContent>
      </Card>

      <PurchasingFormFooter
        formId={formId}
        onCancel={onCancel}
        submitLabel={submitLabel}
        loading={submitting}
      />
    </form>
  );
}
