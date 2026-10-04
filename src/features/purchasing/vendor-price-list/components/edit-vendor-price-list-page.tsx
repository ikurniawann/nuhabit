"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
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
import { useVendorPriceListDetail, useVendorPriceListFormData } from "../queries";
import { useUpdateVendorPriceList } from "../mutations";
import type { VendorPriceListFormData } from "../types";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

type PriceListDetailData = NonNullable<ReturnType<typeof useVendorPriceListDetail>["data"]>;

function priceListFormFromData(priceList: PriceListDetailData) {
  return {
    vendor_id: priceList.vendor_id || "",
    product_id: priceList.product_id || "",
    harga: priceList.harga || 0,
    satuan_id: priceList.satuan_id || "",
    minimum_qty: priceList.minimum_qty || 1,
    lead_time_days: priceList.lead_time_days || 0,
    is_preferred: priceList.is_preferred || false,
    berlaku_dari: priceList.berlaku_dari ? priceList.berlaku_dari.split("T")[0] : "",
    berlaku_sampai: priceList.berlaku_sampai ? priceList.berlaku_sampai.split("T")[0] : "",
    catatan: priceList.catatan || "",
  };
}

export function EditVendorPriceListPage() {
  const params = useParams();
  const priceListId = params.id as string;
  const priceListQuery = useVendorPriceListDetail(priceListId);

  useEffect(() => {
    if (priceListQuery.isError) toast.error(getErrorMessage(priceListQuery.error, "Failed to load data."));
  }, [priceListQuery.isError, priceListQuery.error]);

  if (priceListQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-pink-600" />
      </div>
    );
  }

  if (!priceListQuery.data) {
    return <div className="py-12 text-center text-red-500">Price list not found.</div>;
  }

  // key: form diisi ulang bila data server berubah.
  return <EditVendorPriceListForm key={priceListQuery.dataUpdatedAt} priceListId={priceListId} data={priceListQuery.data} />;
}

function EditVendorPriceListForm({ priceListId, data }: { priceListId: string; data: PriceListDetailData }) {
  const router = useRouter();
  const formDataQuery = useVendorPriceListFormData();
  const updateMutation = useUpdateVendorPriceList();

  const vendors = formDataQuery.data?.vendors ?? [];
  const products = formDataQuery.data?.products ?? [];
  const units = formDataQuery.data?.units ?? [];
  const isSubmitting = updateMutation.isPending;

  const [formData, setFormData] = useState<VendorPriceListFormData>(() => priceListFormFromData(data));

  useEffect(() => {
    if (formDataQuery.isError) toast.error(getErrorMessage(formDataQuery.error, "Failed to load data."));
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

    const payload: Partial<VendorPriceListFormData> = {
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
    payload.catatan = formData.catatan?.trim() || "";

    try {
      await updateMutation.mutateAsync({ id: priceListId, payload });
      toast.success("Price list updated successfully.");
      router.push(PRODUCT_ROUTES.purchasingPriceListDetail(priceListId));
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to update price list."));
    }
  };

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={PRODUCT_ROUTES.purchasingPriceListDetail(priceListId)}
        title="Edit Price List"
        description="Update vendor pricing details for a product."
      />

      <form id="edit-vendor-price-list-form" onSubmit={handleSubmit}>
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
                  <Label className="text-xs">
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
                  <Label className="text-xs">
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
                  {selectedUnitLabel}
                </div>
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
                  <Label className="text-xs">
                    Price per Unit <span className="text-red-500">*</span>
                  </Label>
                  <NumericInput
                    min="0"
                    step="0.01"
                    value={formData.harga}
                    onValueChange={(value) => setFormData((prev) => ({ ...prev, harga: value }))}
                    decimalScale={0}
                    className="h-9 text-sm font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Minimum Quantity</Label>
                  <div className="flex rounded-lg border border-gray-200/80 bg-white focus-within:border-pink-300 focus-within:ring-1 focus-within:ring-pink-100">
                    <NumericInput
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
                  <Label className="text-xs">Lead Time (days)</Label>
                  <div className="flex rounded-lg border border-gray-200/80 bg-white focus-within:border-pink-300 focus-within:ring-1 focus-within:ring-pink-100">
                    <NumericInput
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
                <Label className="text-xs">Notes</Label>
                <Textarea
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
          submitLabel="Save Changes"
          loading={isSubmitting}
          formId="edit-vendor-price-list-form"
        />
      </form>
    </div>
  );
}
