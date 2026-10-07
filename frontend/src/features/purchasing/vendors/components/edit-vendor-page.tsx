"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { Building2, User, CreditCard, FileText, Loader2 } from "lucide-react";
import {
  PurchasingFormFooter,
  PurchasingFormHeader,
} from "@/features/purchasing/components/shared/purchasing-page-header";
import { PRODUCT_ROUTES } from "@/lib/purchasing/item-routes";
import { toast } from "sonner";
import { useVendor } from "../queries";
import { useUpdateVendor } from "../mutations";
import {
  VENDOR_CATEGORY_OPTIONS,
  VENDOR_USAGE_OPTIONS,
  type VendorFormData,
  type VendorCategory,
  type VendorUsageScope,
} from "../types";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

type VendorDetailData = NonNullable<ReturnType<typeof useVendor>["data"]>;

function vendorFormFromData(vendor: VendorDetailData) {
  return {
    name: vendor.name,
    contact_person: vendor.contact_person,
    phone: vendor.phone,
    email: vendor.email,
    address: vendor.address,
    category: vendor.category,
    usage_scope: vendor.usage_scope ?? "keduanya",
    npwp: vendor.npwp || "",
    bank_name: vendor.bank_name || "",
    bank_account: vendor.bank_account || "",
    bank_account_name: vendor.bank_account_name || "",
    notes: vendor.notes || "",
  };
}

export function EditVendorPage() {
  const params = useParams();
  const vendorId = params.id as string;
  const vendorQuery = useVendor(vendorId);

  useEffect(() => {
    if (vendorQuery.isError) toast.error(getErrorMessage(vendorQuery.error, "Failed to load vendor"));
  }, [vendorQuery.isError, vendorQuery.error]);

  if (vendorQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-gray-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-pink-600" />
        Loading vendor...
      </div>
    );
  }

  if (!vendorQuery.data) return null;

  // key: form diisi ulang bila data server berubah.
  return <EditVendorForm key={vendorQuery.dataUpdatedAt} vendorId={vendorId} data={vendorQuery.data} />;
}

function EditVendorForm({ vendorId, data }: { vendorId: string; data: VendorDetailData }) {
  const router = useRouter();
  const updateMutation = useUpdateVendor();
  const saving = updateMutation.isPending;

  const [formData, setFormData] = useState<VendorFormData>(() => vendorFormFromData(data));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name || !formData.contact_person || !formData.phone || !formData.email || !formData.address) {
      toast.error("Name, contact person, phone, email, and address are required");
      return;
    }

    try {
      await updateMutation.mutateAsync({
        id: vendorId,
        payload: {
          ...formData,
          npwp: formData.npwp?.trim() || undefined,
          bank_name: formData.bank_name?.trim() || undefined,
          bank_account: formData.bank_account?.trim() || undefined,
          bank_account_name: formData.bank_account_name?.trim() || undefined,
          notes: formData.notes?.trim() || undefined,
        },
      });
      toast.success("Vendor updated successfully");
      router.push(PRODUCT_ROUTES.purchasingVendorDetail(vendorId));
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to update vendor"));
    }
  };

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={PRODUCT_ROUTES.purchasingVendorDetail(vendorId)}
        title="Edit Vendor"
        description={data.name ? `Update details for ${data.name}` : "Update vendor details"}
      />

      <form id="edit-vendor-form" onSubmit={handleSubmit} className="space-y-6">
        <Card className="border-gray-200/70 shadow-xs">
          <CardHeader className="border-b border-gray-200/70 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4 text-pink-600" />
              Vendor Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="name" className="text-xs">
                  Vendor Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="h-9 text-sm"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">
                  Category <span className="text-red-500">*</span>
                </Label>
                <Combobox
                  options={VENDOR_CATEGORY_OPTIONS}
                  value={formData.category}
                  onChange={(value) =>
                    setFormData({ ...formData, category: (value || "other") as VendorCategory })
                  }
                  placeholder="Select category..."
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">
                  Peruntukan <span className="text-red-500">*</span>
                </Label>
                <Combobox
                  options={VENDOR_USAGE_OPTIONS}
                  value={formData.usage_scope}
                  onChange={(value) =>
                    setFormData({ ...formData, usage_scope: (value || "keduanya") as VendorUsageScope })
                  }
                  placeholder="Pilih peruntukan..."
                  className="h-9 text-sm"
                />
                <p className="text-[11px] text-gray-500">
                  Menentukan vendor muncul di PO produk/F&amp;B, barang operasional, atau keduanya.
                </p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="address" className="text-xs">
                Address <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="address"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                rows={2}
                className="resize-none text-sm"
                required
              />
            </div>
          </CardContent>
        </Card>

        <Card className="border-gray-200/70 shadow-xs">
          <CardHeader className="border-b border-gray-200/70 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <User className="h-4 w-4 text-pink-600" />
              Contact
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 p-4 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="contact_person" className="text-xs">
                Contact Person <span className="text-red-500">*</span>
              </Label>
              <Input
                id="contact_person"
                value={formData.contact_person}
                onChange={(e) => setFormData({ ...formData, contact_person: e.target.value })}
                className="h-9 text-sm"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone" className="text-xs">
                Phone <span className="text-red-500">*</span>
              </Label>
              <Input
                id="phone"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="h-9 text-sm"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs">
                Email <span className="text-red-500">*</span>
              </Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="h-9 text-sm"
                required
              />
            </div>
          </CardContent>
        </Card>

        <Card className="border-gray-200/70 shadow-xs">
          <CardHeader className="border-b border-gray-200/70 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CreditCard className="h-4 w-4 text-pink-600" />
              Tax & Banking
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="npwp" className="text-xs">
                Tax ID (NPWP)
              </Label>
              <Input
                id="npwp"
                value={formData.npwp}
                onChange={(e) => setFormData({ ...formData, npwp: e.target.value })}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bank_name" className="text-xs">
                Bank Name
              </Label>
              <Input
                id="bank_name"
                value={formData.bank_name}
                onChange={(e) => setFormData({ ...formData, bank_name: e.target.value })}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bank_account" className="text-xs">
                Bank Account Number
              </Label>
              <Input
                id="bank_account"
                value={formData.bank_account}
                onChange={(e) => setFormData({ ...formData, bank_account: e.target.value })}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bank_account_name" className="text-xs">
                Account Holder Name
              </Label>
              <Input
                id="bank_account_name"
                value={formData.bank_account_name}
                onChange={(e) => setFormData({ ...formData, bank_account_name: e.target.value })}
                className="h-9 text-sm"
              />
            </div>
          </CardContent>
        </Card>

        <Card className="border-gray-200/70 shadow-xs">
          <CardHeader className="border-b border-gray-200/70 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4 text-pink-600" />
              Notes
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <Textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
              className="resize-none text-sm"
            />
          </CardContent>
        </Card>

        <PurchasingFormFooter
          formId="edit-vendor-form"
          onCancel={() => router.back()}
          submitLabel="Save Changes"
          loading={saving}
        />
      </form>
    </div>
  );
}
