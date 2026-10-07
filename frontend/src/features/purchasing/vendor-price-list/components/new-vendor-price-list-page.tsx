"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, Calendar, Package, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Combobox } from "@/components/ui/combobox";
import { DsDateTimePicker } from "@/components/design-system";
import { NumericInput } from "@/components/ui/numeric-input";
import {
  PurchasingFormFooter,
  PurchasingFormHeader,
} from "@/features/purchasing/components/shared/purchasing-page-header";
import { PRODUCT_ROUTES } from "@/lib/purchasing/item-routes";
import { useVendorPriceListFormData } from "../queries";
import { useCreateVendorPriceList } from "../mutations";
import type { VendorPriceListFormData } from "../types";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function NewVendorPriceListPage() {
  const router = useRouter();
  const formDataQuery = useVendorPriceListFormData();
  const vendors = formDataQuery.data?.vendors ?? [];
  const products = formDataQuery.data?.products ?? [];
  const units = formDataQuery.data?.units ?? [];
  const loading = formDataQuery.isLoading;
  const createMutation = useCreateVendorPriceList();
  const isSubmitting = createMutation.isPending;

  const [formData, setFormData] = useState<VendorPriceListFormData>({
    vendor_id: "",
    product_id: "",
    harga: 0,
    satuan_id: "",
    minimum_qty: 1,
    lead_time_days: 0,
    is_preferred: false,
    berlaku_dari: "",
    berlaku_sampai: "",
    catatan: "",
  });

  useEffect(() => {
    if (formDataQuery.isError) {
      toast.error(getErrorMessage(formDataQuery.error, "Failed to load form data."));
    }
  }, [formDataQuery.isError, formDataQuery.error]);

  const selectedProduct = products.find((product) => product.id === formData.product_id);
  const selectedUnit =
    units.find((unit) => unit.id === formData.satuan_id) ||
    units.find((unit) => unit.id === selectedProduct?.satuan_id);
  const selectedUnitLabel = selectedUnit?.simbol || selectedUnit?.nama || "unit";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.vendor_id) {
      toast.error("Vendor is required.");
      return;
    }
    if (!formData.product_id) {
      toast.error("Product is required.");
      return;
    }

    const payload: VendorPriceListFormData = {
      vendor_id: formData.vendor_id,
      product_id: formData.product_id,
      harga: Number(formData.harga),
      satuan_id: formData.satuan_id || selectedProduct?.satuan_id || undefined,
      minimum_qty: Number(formData.minimum_qty),
      lead_time_days: Number(formData.lead_time_days),
      is_preferred: formData.is_preferred,
    };

    if (formData.berlaku_dari) {
      const dateStr = formData.berlaku_dari;
      payload.berlaku_dari =
        dateStr.length === 10 ? dateStr : new Date(dateStr).toISOString().split("T")[0];
    }
    if (formData.berlaku_sampai) {
      const dateStr = formData.berlaku_sampai;
      payload.berlaku_sampai =
        dateStr.length === 10 ? dateStr : new Date(dateStr).toISOString().split("T")[0];
    }
    if (formData.catatan?.trim()) {
      payload.catatan = formData.catatan.trim();
    }

    try {
      await createMutation.mutateAsync(payload);
      toast.success("Price list created successfully.");
      router.push(PRODUCT_ROUTES.purchasingPriceList);
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to create price list."));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-pink-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={PRODUCT_ROUTES.purchasingPriceList}
        title="Add Price List"
        description="Enter vendor pricing details for a product."
      />

      <form id="vendor-price-list-form" onSubmit={handleSubmit}>
        <div className="space-y-6">
          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Package className="h-4 w-4" />
                Vendor & Product
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="vendor" className="text-xs">
                    Vendor <span className="text-red-500">*</span>
                  </Label>
                  <Combobox
                    options={vendors.map((vendor) => ({
                      value: vendor.id,
                      label: vendor.name,
                      description: vendor.code,
                    }))}
                    value={formData.vendor_id}
                    onChange={(value) => setFormData((prev) => ({ ...prev, vendor_id: value }))}
                    placeholder="Select vendor..."
                    searchPlaceholder="Search..."
                    emptyMessage="Vendor not found"
                    allowClear
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="product" className="text-xs">
                    Product <span className="text-red-500">*</span>
                  </Label>
                  <Combobox
                    options={products.map((product) => ({
                      value: product.id,
                      label: product.nama,
                      description: product.kode,
                    }))}
                    value={formData.product_id}
                    onChange={(value) => {
                      const product = products.find((item) => item.id === value);
                      setFormData((prev) => ({
                        ...prev,
                        product_id: value,
                        satuan_id: product?.satuan_id || "",
                      }));
                    }}
                    placeholder="Select product..."
                    searchPlaceholder="Search..."
                    emptyMessage="Product not found"
                    allowClear
                    className="h-9 text-sm"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Unit</Label>
                <div className="flex h-9 items-center rounded-lg border border-gray-200/80 bg-gray-50 px-3 text-sm text-gray-700">
                  {selectedProduct
                    ? selectedUnitLabel
                    : "Select a product to see its base unit"}
                </div>
                <p className="text-xs text-gray-500">
                  Product price lists use the product base unit from master data.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <DollarSign className="h-4 w-4" />
                Price & Terms
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="harga" className="text-xs">
                    Price per Unit <span className="text-red-500">*</span>
                  </Label>
                  <NumericInput
                    id="harga"
                    min="0"
                    step="0.01"
                    value={formData.harga}
                    onValueChange={(value) => setFormData((prev) => ({ ...prev, harga: value }))}
                    decimalScale={0}
                    className="h-9 text-sm font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="minimum_qty" className="text-xs">
                    Minimum Quantity
                  </Label>
                  <div className="flex rounded-lg border border-gray-200/80 bg-white focus-within:border-pink-300 focus-within:ring-1 focus-within:ring-pink-100">
                    <NumericInput
                      id="minimum_qty"
                      min="1"
                      value={formData.minimum_qty}
                      onValueChange={(value) =>
                        setFormData((prev) => ({ ...prev, minimum_qty: value || 1 }))
                      }
                      decimalScale={4}
                      className="h-9 rounded-r-none border-0 text-sm shadow-none focus-visible:ring-0"
                    />
                    <div className="flex min-w-14 items-center justify-center rounded-r-lg border-l border-gray-200/80 bg-gray-50 px-3 text-xs font-semibold uppercase text-gray-500">
                      {selectedUnitLabel}
                    </div>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lead_time" className="text-xs">
                    Lead Time (days)
                  </Label>
                  <div className="flex rounded-lg border border-gray-200/80 bg-white focus-within:border-pink-300 focus-within:ring-1 focus-within:ring-pink-100">
                    <NumericInput
                      id="lead_time"
                      min="0"
                      value={formData.lead_time_days}
                      onValueChange={(value) =>
                        setFormData((prev) => ({ ...prev, lead_time_days: value }))
                      }
                      decimalScale={0}
                      className="h-9 rounded-r-none border-0 text-sm shadow-none focus-visible:ring-0"
                    />
                    <div className="flex min-w-14 items-center justify-center rounded-r-lg border-l border-gray-200/80 bg-gray-50 px-3 text-xs font-semibold text-gray-500">
                      days
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Calendar className="h-4 w-4" />
                Contract Validity
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <DsDateTimePicker
                  label="Effective From"
                  value={formData.berlaku_dari}
                  onChange={(value) => setFormData((prev) => ({ ...prev, berlaku_dari: value }))}
                  placeholder="Select start date..."
                  dateOnly
                />
                <DsDateTimePicker
                  label="Effective Until"
                  value={formData.berlaku_sampai}
                  onChange={(value) => setFormData((prev) => ({ ...prev, berlaku_sampai: value }))}
                  placeholder="Select end date..."
                  dateOnly
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="catatan" className="text-xs">
                  Notes
                </Label>
                <Textarea
                  id="catatan"
                  value={formData.catatan}
                  onChange={(e) => setFormData((prev) => ({ ...prev, catatan: e.target.value }))}
                  placeholder="Additional notes..."
                  rows={2}
                  className="resize-none text-sm"
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <PurchasingFormFooter
          onCancel={() => router.back()}
          submitLabel="Save Price List"
          loading={isSubmitting}
          formId="vendor-price-list-form"
        />
      </form>
    </div>
  );
}
