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
import type { ProductPRFormInput, ProductPRFormProduct } from "@/features/purchasing/product-pr/types";

const productPrItemSchema = z.object({
  product_id: z.string().min(1, "Produk wajib dipilih"),
  satuan_id: z.string().optional(),
  description: z.string().min(1, "Deskripsi wajib diisi"),
  qty: z.preprocess(
    (value) => parseLocaleNumber(value) ?? value,
    z.number().min(1, "Jumlah minimal 1")
  ),
  unit: z.string().min(1, "Satuan wajib diisi"),
  estimated_price: z.preprocess(
    (value) => parseLocaleNumber(value) ?? 0,
    z.number().min(0)
  ),
});

const productPrSchema = z.object({
  department_id: z.string().min(1, "Departemen wajib dipilih"),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  required_date: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(productPrItemSchema).min(1, "Minimal satu item"),
});

type ProductPRFormValues = z.infer<typeof productPrSchema>;

interface ProductPRFormProps {
  departments: { id: string; name: string }[];
  products: ProductPRFormProduct[];
  units: { id: string; nama: string }[];
  onSubmit: (data: ProductPRFormInput, action: "draft" | "submit") => void | Promise<void>;
  isLoading?: boolean;
  initialData?: ProductPRFormInput;
  mode?: "create" | "edit";
  cancelHref?: string;
}

export function ProductPRForm({
  departments,
  products,
  units,
  onSubmit,
  isLoading,
  initialData,
  mode = "create",
  cancelHref,
}: ProductPRFormProps) {
  const router = useRouter();
  const formId = "product-purchase-request-form";

  const {
    register,
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<ProductPRFormValues>({
    resolver: zodResolver(productPrSchema) as Resolver<ProductPRFormValues>,
    defaultValues: initialData || {
      priority: "medium",
      items: [{ product_id: "", satuan_id: "", description: "", qty: 1, unit: "", estimated_price: 0 }],
    },
  });

  register("priority");

  const { fields, append, remove } = useFieldArray({ control, name: "items" });

  const selectedDepartment = useWatch({ control, name: "department_id" });
  const requiredDate = useWatch({ control, name: "required_date" });
  const priority = useWatch({ control, name: "priority" });
  const items = useWatch({ control, name: "items" });
  const totalAmount = prLinesTotal(items);

  function getUnitName(unitId?: string) {
    return units.find((unit) => unit.id === unitId)?.nama || "";
  }

  async function applyEstimatedPrice(index: number, productId: string, fallbackPrice = 0) {
    // Sama seperti RM / general: estimasi dari harga master, bukan price list vendor.
    void productId;
    setValue(`items.${index}.estimated_price`, Math.round(Number(fallbackPrice || 0)), {
      shouldDirty: true,
      shouldValidate: true,
    });
  }

  async function handleSelectProduct(index: number, productId: string) {
    const product = products.find((item) => item.id === productId);
    const unitId = product?.satuan_id || "";
    const unitName = product?.satuan_nama || getUnitName(unitId);
    setValue(`items.${index}.product_id`, productId, { shouldValidate: true });
    setValue(`items.${index}.description`, product?.nama || "", { shouldValidate: true });
    setValue(`items.${index}.unit`, unitName, { shouldValidate: true });
    setValue(`items.${index}.satuan_id`, unitId);
    await applyEstimatedPrice(index, productId, Number(product?.harga_modal || 0));
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
                  <Label className="text-xs">
                    Departemen <span className="text-red-500">*</span>
                  </Label>
                  <Combobox
                    options={departments.map((dept) => ({ value: dept.id, label: dept.name }))}
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
                  <Label className="text-xs">
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
                    onChange={(value) =>
                      setValue("priority", value as ProductPRFormValues["priority"], {
                        shouldValidate: true,
                      })
                    }
                    placeholder="Pilih prioritas..."
                    searchPlaceholder="Cari..."
                    emptyMessage="Prioritas tidak ditemukan"
                    className="!w-full h-9 text-sm"
                  />
                </div>
              </div>
              <DsDateTimePicker
                label="Tanggal Dibutuhkan"
                value={requiredDate}
                onChange={(value) => setValue("required_date", value)}
                placeholder="Pilih tanggal dibutuhkan..."
                dateOnly
              />
            </CardContent>
          </Card>

          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="flex flex-row items-center justify-between border-b border-gray-200/70 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ShoppingBasket className="h-4 w-4" />
                Item Permintaan
              </CardTitle>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1"
                onClick={() =>
                  append({
                    product_id: "",
                    satuan_id: "",
                    description: "",
                    qty: 1,
                    unit: "",
                    estimated_price: 0,
                  })
                }
              >
                <Plus className="h-3.5 w-3.5" />
                Tambah Item
              </Button>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              {fields.map((field, index) => (
                <div key={field.id} className="rounded-xl border border-gray-200/70 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-900">Item {index + 1}</p>
                    {fields.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 text-red-500 hover:text-red-600"
                        onClick={() => remove(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                    <div className="min-w-0 space-y-1.5 lg:col-span-4">
                      <Label className="text-xs">
                        Produk <span className="text-red-500">*</span>
                      </Label>
                      <Combobox
                        options={products.map((product) => ({
                          value: product.id,
                          label: product.nama,
                          description: product.kode,
                        }))}
                        value={items[index]?.product_id || ""}
                        onChange={(value) => handleSelectProduct(index, value)}
                        placeholder="Pilih produk..."
                        searchPlaceholder="Cari produk..."
                        emptyMessage="Produk tidak ditemukan"
                        allowClear
                        className="!w-full h-9 text-sm"
                      />
                    </div>
                    <div className="min-w-0 space-y-1.5 lg:col-span-4">
                      <Label className="text-xs">Deskripsi</Label>
                      <input type="hidden" {...register(`items.${index}.description`)} />
                      <div className="flex h-9 w-full items-center rounded-lg border border-gray-200/80 bg-gray-50 px-2.5 text-sm text-gray-700">
                        {items[index]?.description || "Pilih produk terlebih dahulu"}
                      </div>
                    </div>
                    <div className="min-w-0 space-y-1.5 lg:col-span-2">
                      <Label className="text-xs">Jumlah</Label>
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
                      <div className="flex h-9 items-center rounded-lg border border-gray-200/80 bg-gray-50 px-2.5 text-sm text-gray-700">
                        {items[index]?.unit || "-"}
                      </div>
                    </div>
                    <div className="min-w-0 space-y-1.5 lg:col-span-3">
                      <Label className="text-xs">Harga Estimasi</Label>
                      <NumericInput
                        value={items[index]?.estimated_price || 0}
                        onValueChange={(value) =>
                          setValue(`items.${index}.estimated_price`, value, {
                            shouldDirty: true,
                            shouldValidate: true,
                          })
                        }
                        decimalScale={0}
                        className="h-9 text-sm"
                      />
                    </div>
                    <div className="min-w-0 rounded-lg bg-gray-50/80 p-3 lg:col-span-3">
                      <p className="text-xs text-gray-500">Subtotal</p>
                      <p className="text-sm font-semibold text-gray-900">
                        {formatNumber(prLineSubtotal(items[index]))}
                      </p>
                    </div>
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
              <div className="space-y-1.5">
                <Label className="text-xs">Catatan</Label>
                <Textarea {...register("notes")} placeholder="Catatan tambahan..." rows={4} className="resize-none text-sm" />
              </div>
              <div className="rounded-xl border border-gray-200/70 bg-gray-50/70 p-4">
                <p className="text-sm text-gray-500">Estimasi Total</p>
                <p className="mt-1 text-2xl font-bold text-gray-900">{formatNumber(totalAmount)}</p>
              </div>
              <div className="flex flex-col gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSubmitting}
                  onClick={() => (cancelHref ? router.push(cancelHref) : router.back())}
                  className="h-10"
                >
                  Batal
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSubmitting}
                  onClick={() => submitWithAction("draft")}
                  className="h-10"
                >
                  {submitAction === "draft" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Simpan Draft
                </Button>
                <Button type="submit" disabled={isSubmitting} className="h-10 purchasing-main-button">
                  {submitAction === "submit" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {mode === "edit" ? "Simpan & Ajukan" : "Ajukan Permintaan"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </form>
  );
}
