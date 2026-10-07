"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { useCreateVendor } from "../mutations";
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

const EMPTY_FORM: VendorFormData = {
  name: "",
  contact_person: "",
  phone: "",
  email: "",
  address: "",
  category: "other",
  usage_scope: "keduanya",
  npwp: "",
  bank_name: "",
  bank_account: "",
  bank_account_name: "",
  notes: "",
};

export function NewVendorPage() {
  const router = useRouter();
  const createMutation = useCreateVendor();
  const loading = createMutation.isPending;
  const [formData, setFormData] = useState<VendorFormData>(EMPTY_FORM);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name || !formData.contact_person || !formData.phone || !formData.email || !formData.address) {
      toast.error("Name, contact person, phone, email, and address are required");
      return;
    }

    try {
      await createMutation.mutateAsync({
        ...formData,
        npwp: formData.npwp?.trim() || undefined,
        bank_name: formData.bank_name?.trim() || undefined,
        bank_account: formData.bank_account?.trim() || undefined,
        bank_account_name: formData.bank_account_name?.trim() || undefined,
        notes: formData.notes?.trim() || undefined,
      });
      toast.success("Vendor created successfully");
      router.push(PRODUCT_ROUTES.purchasingVendor);
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to create vendor"));
    }
  };

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={PRODUCT_ROUTES.purchasingVendor}
        title="Add Vendor"
        description="Enter details for a new vendor record"
      />

      <form id="new-vendor-form" onSubmit={handleSubmit} className="space-y-6">
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
              placeholder="Additional notes (optional)..."
              rows={3}
              className="resize-none text-sm"
            />
          </CardContent>
        </Card>

        <PurchasingFormFooter
          formId="new-vendor-form"
          onCancel={() => router.back()}
          submitLabel="Save Vendor"
          loading={loading}
        />
      </form>

      {loading && (
        <div className="sr-only">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      )}
    </div>
  );
}
