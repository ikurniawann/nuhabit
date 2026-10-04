"use client";

import { useRouter } from "next/navigation";
import { useForm, useFieldArray, useWatch, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { FileText, Loader2, Plus, ShoppingBasket, StickyNote, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Combobox } from "@/components/ui/combobox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NumericInput } from "@/components/ui/numeric-input";
import { DsDateTimePicker } from "@/components/design-system";
import { formatNumber } from "@/lib/format";
import { prLineSubtotal, prLinesTotal } from "@/lib/purchasing/pr-ui-form";
import { usePrFormSubmit } from "@/features/purchasing/components/shared/use-pr-form-submit";
import { parseLocaleNumber } from "@/lib/purchasing/parse-locale-number";
import { getRawMaterialPurchasePrice } from "@/lib/purchasing/api-client/raw-materials";

const prItemSchema = z.object({
  raw_material_id: z.string().min(1, "Bahan baku wajib diisi"),
  satuan_id: z.string().optional(),
  description: z.string().min(1, "Deskripsi wajib diisi"),
  qty: z.preprocess(
    (value) => parseLocaleNumber(value) ?? value,
    z.number().min(1, "Qty minimal 1")
  ),
  unit: z.string().min(1, "Satuan wajib diisi"),
  estimated_price: z.preprocess(
    (value) => parseLocaleNumber(value) ?? 0,
    z.number().min(0)
  ),
});

const prSchema = z.object({
  department_id: z.string().min(1, "Departemen wajib diisi"),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  required_date: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(prItemSchema).min(1, "Minimal satu item wajib diisi"),
});

type PRFormData = z.infer<typeof prSchema>;

interface PRFormProps {
  departments: { id: string; name: string }[];
  materials: {
    id: string;
    kode: string;
    nama: string;
    satuan_besar_id?: string;
    satuan_besar_nama?: string;
    avg_cost?: number;
    unit_conversions?: {
      satuan_id: string;
      qty_in_base_unit: number;
      is_active?: boolean;
    }[];
  }[];
  units: { id: string; nama: string }[];
  onSubmit: (data: PRFormData, action: "draft" | "submit") => void | Promise<void>;
  isLoading?: boolean;
  initialData?: PRFormData;
  mode?: "create" | "edit";
  cancelHref?: string;
  hideItemPricing?: boolean;
}

export function PRForm({
  departments,
  materials,
  units,
  onSubmit,
  isLoading,
  initialData,
  mode = "create",
  cancelHref = "/dashboard/purchasing/pr",
  hideItemPricing = false,
}: PRFormProps) {
  const router = useRouter();
  const formId = "purchase-request-form";

  const {
    register,
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<PRFormData>({
    resolver: zodResolver(prSchema) as Resolver<PRFormData>,
    defaultValues: initialData || {
      priority: "medium",
      items: [{ raw_material_id: "", satuan_id: "", description: "", qty: 1, unit: "", estimated_price: 0 }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "items",
  });

  const selectedDepartment = useWatch({ control, name: "department_id" });
  const requiredDate = useWatch({ control, name: "required_date" });
  const priority = useWatch({ control, name: "priority" });
  const items = useWatch({ control, name: "items" });
  const totalAmount = prLinesTotal(items);

  function getUnitName(unitId?: string) {
    return units.find((unit) => unit.id === unitId)?.nama || "";
  }

  function getMaterialUnitOptions(materialId?: string) {
    const material = materials.find((item) => item.id === materialId);
    const conversionUnitIds = (material?.unit_conversions || [])
      .filter((conversion) => conversion.is_active !== false)
      .map((conversion) => conversion.satuan_id);
    const unitIds = Array.from(
      new Set([material?.satuan_besar_id, ...conversionUnitIds].filter(Boolean) as string[])
    );

    return unitIds
      .map((unitId) => {
        const unit = units.find((item) => item.id === unitId);
        return unit ? { value: unit.id, label: unit.nama } : null;
      })
      .filter(Boolean) as { value: string; label: string }[];
  }

  async function applyEstimatedPrice(
    index: number,
    materialId: string,
    unitId?: string,
    fallbackPrice: unknown = 0
  ) {
    if (hideItemPricing) {
      setValue(`items.${index}.estimated_price`, 0);
      return;
    }

    const fallback = parseLocaleNumber(fallbackPrice) ?? 0;
    setValue(`items.${index}.estimated_price`, fallback);

    if (!materialId) return;

    try {
      const suggestion = await getRawMaterialPurchasePrice(materialId, { satuanId: unitId });
      if (suggestion && suggestion.unit_price > 0) {
        setValue(`items.${index}.estimated_price`, Math.round(suggestion.unit_price), {
          shouldDirty: true,
          shouldValidate: true,
        });
      }
    } catch (error) {
      console.error("Error loading estimated price:", error);
    }
  }

  async function handleSelectMaterial(index: number, materialId: string) {
    const material = materials.find((item) => item.id === materialId);
    const unitId = material?.satuan_besar_id || "";
    const unitName = material?.satuan_besar_nama || getUnitName(unitId);
    setValue(`items.${index}.raw_material_id`, materialId, { shouldValidate: true });
    setValue(`items.${index}.description`, material?.nama || "", { shouldValidate: true });
    setValue(`items.${index}.unit`, unitName, { shouldValidate: true });
    setValue(`items.${index}.satuan_id`, unitId);
    await applyEstimatedPrice(index, materialId, unitId, material?.avg_cost || 0);
  }

  async function handleSelectUnit(index: number, unitId: string) {
    const materialId = items[index]?.raw_material_id || "";
    const material = materials.find((item) => item.id === materialId);
    setValue(`items.${index}.satuan_id`, unitId);
    setValue(`items.${index}.unit`, getUnitName(unitId));
    await applyEstimatedPrice(index, materialId, unitId, material?.avg_cost || 0);
  }

  const { submitAction, submitWithAction } = usePrFormSubmit(handleSubmit, onSubmit);
  const isSubmitting = isLoading || submitAction !== null;

  return (
    <form
      id={formId}
      onSubmit={(event) => {
        event.preventDefault();
        submitWithAction("submit");
      }}
      className="space-y-6"
    >
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="space-y-6 xl:col-span-8">
          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" />
                Informasi Permintaan
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <input type="hidden" {...register("department_id")} />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="min-w-0 space-y-1.5">
                  <Label htmlFor="department_id" className="text-xs">
                    Departemen <span className="text-red-500">*</span>
                  </Label>
                  <Combobox
                    options={departments.map((dept) => ({
                      value: dept.id,
                      label: dept.name,
                    }))}
                    value={selectedDepartment}
                    onChange={(value) => setValue("department_id", value, { shouldValidate: true })}
                    placeholder="Pilih departemen..."
                    searchPlaceholder="Cari departemen..."
                    emptyMessage="Departemen tidak ditemukan"
                    allowClear
                    className="!w-full h-9 text-sm"
                  />
                  {errors.department_id && (
                    <p className="text-xs text-red-500">{errors.department_id.message}</p>
                  )}
                </div>

                <div className="min-w-0 space-y-1.5">
                  <Label htmlFor="priority" className="text-xs">
                    Prioritas <span className="text-red-500">*</span>
                  </Label>
                  <Combobox
                    options={[
                      { value: "low", label: "Rendah" },
                      { value: "medium", label: "Sedang" },
                      { value: "high", label: "Tinggi" },
                      { value: "urgent", label: "Mendesak" },
                    ]}
                    value={priority}
                    onChange={(value) => setValue("priority", value as PRFormData["priority"])}
                    placeholder="Pilih prioritas..."
                    searchPlaceholder="Cari prioritas..."
                    emptyMessage="Prioritas tidak ditemukan"
                    className="!w-full h-9 text-sm"
                  />
                </div>
              </div>

              <DsDateTimePicker
                label="Tanggal Dibutuhkan"
                value={requiredDate || ""}
                onChange={(value) => setValue("required_date", value)}
                placeholder="Pilih tanggal dibutuhkan..."
                dateOnly
              />
            </CardContent>
          </Card>

          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="flex flex-col gap-3 border-b border-gray-200/70 pb-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShoppingBasket className="h-4 w-4" />
                  Item Diminta
                </CardTitle>
                <p className="mt-1 text-xs text-gray-500">
                  Pilih bahan baku dari data master agar bisa dikonversi menjadi purchase order.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  append({
                    raw_material_id: "",
                    satuan_id: "",
                    description: "",
                    qty: 1,
                    unit: "",
                    estimated_price: 0,
                  })
                }
                className="purchasing-secondary-button w-full sm:w-auto"
              >
                <Plus className="mr-1 h-4 w-4" /> Tambah Item
              </Button>
            </CardHeader>
            <CardContent className="space-y-3 pt-4">
              {fields.map((field, index) => (
                <div key={field.id} className="rounded-xl border border-gray-200/70 bg-white/70 p-4">
                  <div className="mb-4 flex items-center justify-between border-b border-gray-200/70 pb-3">
                    <p className="text-sm font-medium text-gray-900">Item #{index + 1}</p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => remove(index)}
                      disabled={fields.length === 1}
                      className="h-8 text-red-500 hover:text-red-600"
                    >
                      <Trash2 className="mr-1 h-4 w-4" />
                      Hapus
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                    <div className="min-w-0 space-y-1.5 lg:col-span-4">
                      <Label className="text-xs">
                        Bahan Baku <span className="text-red-500">*</span>
                      </Label>
                      <Combobox
                        options={materials.map((material) => ({
                          value: material.id,
                          label: material.nama,
                          description: material.kode,
                        }))}
                        value={items[index]?.raw_material_id || ""}
                        onChange={(value) => handleSelectMaterial(index, value)}
                        placeholder="Pilih bahan baku..."
                        searchPlaceholder="Cari bahan baku..."
                        emptyMessage="Bahan baku tidak ditemukan"
                        allowClear
                        className="!w-full h-9 text-sm"
                      />
                      {errors.items?.[index]?.raw_material_id && (
                        <p className="mt-1 text-xs text-red-500">
                          {errors.items[index]?.raw_material_id?.message}
                        </p>
                      )}
                    </div>

                    <div className="min-w-0 space-y-1.5 lg:col-span-4">
                      <Label className="text-xs">Deskripsi</Label>
                      <input type="hidden" {...register(`items.${index}.description`)} />
                      <div className="flex h-9 w-full items-center rounded-lg border border-gray-200/80 bg-gray-50 px-2.5 text-sm text-gray-700">
                        {items[index]?.description || "Pilih bahan baku terlebih dahulu"}
                      </div>
                    </div>

                    <div className="min-w-0 space-y-1.5 lg:col-span-2">
                      <Label className="text-xs">Qty</Label>
                      <NumericInput
                        value={items[index]?.qty || 0}
                        onValueChange={(value) =>
                          setValue(`items.${index}.qty`, value, {
                            shouldDirty: true,
                            shouldValidate: true,
                          })
                        }
                        decimalScale={4}
                        className="h-9 text-sm"
                      />
                    </div>

                    <div className="min-w-0 space-y-1.5 lg:col-span-2">
                      <Label className="text-xs">Satuan</Label>
                      <input type="hidden" {...register(`items.${index}.unit`)} />
                      <input type="hidden" {...register(`items.${index}.satuan_id`)} />
                      <Combobox
                        options={getMaterialUnitOptions(items[index]?.raw_material_id)}
                        value={items[index]?.satuan_id || ""}
                        onChange={(value) => handleSelectUnit(index, value)}
                        placeholder="Pilih satuan..."
                        searchPlaceholder="Cari satuan..."
                        emptyMessage={
                          items[index]?.raw_material_id
                            ? "Belum ada satuan untuk bahan baku ini"
                            : "Pilih bahan baku terlebih dahulu"
                        }
                        allowClear={false}
                        disabled={!items[index]?.raw_material_id}
                        className="!w-full h-9 text-sm"
                      />
                    </div>

                    {!hideItemPricing && (
                      <>
                        <div className="min-w-0 space-y-1.5 lg:col-span-3">
                          <Label className="text-xs">
                            Est. Harga Satuan <span className="text-gray-400">(opsional)</span>
                          </Label>
                          <NumericInput
                            value={items[index]?.estimated_price || 0}
                            onValueChange={(value) =>
                              setValue(`items.${index}.estimated_price`, value, {
                                shouldDirty: true,
                                shouldValidate: true,
                              })
                            }
                            decimalScale={0}
                            placeholder="Biarkan kosong jika belum diketahui"
                            className="h-9 text-sm"
                          />
                        </div>

                        <div className="min-w-0 rounded-lg bg-gray-50/80 p-3 lg:col-span-3">
                          <p className="text-xs text-gray-500">Subtotal</p>
                          <p className="text-sm font-semibold text-gray-900">
                            {formatNumber(prLineSubtotal(items[index]))}
                          </p>
                        </div>
                      </>
                    )}
                    {hideItemPricing && (
                      <input type="hidden" {...register(`items.${index}.estimated_price`)} />
                    )}
                  </div>
                </div>
              ))}

              {errors.items && <p className="text-sm text-red-500">{errors.items.message}</p>}
            </CardContent>
          </Card>
        </div>

        <div className="xl:col-span-4">
          <Card className="border-gray-200/70 shadow-xs xl:sticky xl:top-6">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <StickyNote className="h-4 w-4" />
                Catatan & Ringkasan
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="notes" className="text-xs">
                  Catatan
                </Label>
                <Textarea
                  {...register("notes")}
                  placeholder="Catatan tambahan..."
                  rows={4}
                  className="resize-none text-sm"
                />
              </div>

              <div className="rounded-xl border border-gray-200/70 bg-gray-50/70 p-4">
                {!hideItemPricing && (
                  <>
                    <p className="text-sm text-gray-500">Estimasi Total</p>
                    <p className="mt-1 text-2xl font-bold text-gray-900">{formatNumber(totalAmount)}</p>
                  </>
                )}
                <div className={`rounded-lg bg-white p-3 text-left ${hideItemPricing ? "" : "mt-4"}`}>
                  <p className="text-xs font-medium text-gray-500">Perlu Persetujuan</p>
                  <p className="mt-1 text-sm font-medium text-gray-900">Head Departemen</p>
                  <p className="mt-1 text-xs text-gray-500">
                    Setiap purchase request yang diajukan memerlukan persetujuan kebutuhan. Persetujuan
                    nilai akhir dilakukan pada purchase order.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="flex flex-col-reverse gap-3 border-t border-gray-200/70 pt-4 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          disabled={isSubmitting}
          onClick={() => router.push(cancelHref)}
          className="purchasing-secondary-button w-full sm:w-auto"
        >
          Batal
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={isSubmitting}
          onClick={() => submitWithAction("draft")}
          className="purchasing-secondary-button w-full sm:w-auto"
        >
          {submitAction === "draft" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {submitAction === "draft"
            ? "Menyimpan..."
            : mode === "edit"
              ? "Simpan Perubahan"
              : "Simpan Draf"}
        </Button>
        <Button
          type="submit"
          disabled={isSubmitting}
          className="purchasing-main-button w-full sm:w-auto"
        >
          {submitAction === "submit" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {submitAction === "submit" ? "Mengirim..." : "Ajukan"}
        </Button>
      </div>
    </form>
  );
}
