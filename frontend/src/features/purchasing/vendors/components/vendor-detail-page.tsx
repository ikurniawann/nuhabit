"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PurchasingPageHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import { PRODUCT_ROUTES } from "@/lib/purchasing/item-routes";
import {
  Building2,
  Edit,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Trash2,
  User,
  CreditCard,
} from "lucide-react";
import { toast } from "sonner";
import { useVendor } from "../queries";
import { useDeactivateVendor } from "../mutations";
import { getVendorCategoryLabel, getVendorUsageLabel } from "../types";
import { formatDate } from "@/lib/format";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-gray-900">{value?.trim() || "-"}</p>
    </div>
  );
}

export function VendorDetailPage({ id: idProp }: { id?: string }) {
  const params = useParams();
  const router = useRouter();
  const vendorId = idProp || (params.id as string);

  const vendorQuery = useVendor(vendorId);
  const vendor = vendorQuery.data ?? null;
  const loading = vendorQuery.isLoading;

  const deactivateMutation = useDeactivateVendor();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const handleDeactivate = async () => {
    if (!vendor || deactivateMutation.isPending) return;
    try {
      await deactivateMutation.mutateAsync(vendor.id);
      toast.success("Vendor deactivated successfully");
      setDeleteDialogOpen(false);
      router.push(PRODUCT_ROUTES.purchasingVendor);
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to deactivate vendor"));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-gray-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-pink-600" />
        Loading vendor...
      </div>
    );
  }

  if (!vendor) {
    return (
      <div className="space-y-4 py-16 text-center">
        <p className="text-sm text-gray-500">Vendor not found</p>
        <Link href={PRODUCT_ROUTES.purchasingVendor}>
          <Button variant="outline" className="purchasing-secondary-button">
            Back to Vendor List
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title={vendor.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-700">
              {vendor.code}
            </span>
            <span className="text-gray-300">•</span>
            <span>{getVendorCategoryLabel(vendor.category)}</span>
            <span className="text-gray-300">•</span>
            <span>{getVendorUsageLabel(vendor.usage_scope)}</span>
            <span className="ml-1">
              {vendor.is_active ? (
                <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">Active</Badge>
              ) : (
                <Badge variant="secondary">Inactive</Badge>
              )}
            </span>
          </span>
        }
        actions={
          <>
            <Link href={PRODUCT_ROUTES.purchasingVendorEdit(vendor.id)}>
              <Button variant="outline" className="purchasing-secondary-button w-full sm:w-auto">
                <Edit className="mr-2 h-4 w-4" />
                Edit
              </Button>
            </Link>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(true)}
              className="h-10 w-full rounded-lg border-red-200/80 bg-white px-3 text-sm font-medium text-red-600 shadow-sm hover:!border-red-200 hover:!bg-red-50 hover:!text-red-700 sm:w-auto"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Deactivate
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="border-gray-200/70 shadow-xs">
          <CardHeader className="border-b border-gray-200/70 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4 text-pink-600" />
              Vendor Information
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 p-4 sm:grid-cols-2">
            <InfoRow label="Vendor Code" value={vendor.code} />
            <InfoRow label="Category" value={getVendorCategoryLabel(vendor.category)} />
            <InfoRow label="Peruntukan" value={getVendorUsageLabel(vendor.usage_scope)} />
            <InfoRow label="Created At" value={formatDate(vendor.created_at)} />
            <div className="sm:col-span-2">
              <p className="text-xs font-medium text-gray-500">Address</p>
              <p className="mt-1 flex items-start gap-2 text-sm text-gray-900">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                {vendor.address}
              </p>
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
          <CardContent className="space-y-4 p-4">
            <InfoRow label="Contact Person" value={vendor.contact_person} />
            <div>
              <p className="text-xs font-medium text-gray-500">Phone</p>
              <p className="mt-1 flex items-center gap-2 text-sm text-gray-900">
                <Phone className="h-4 w-4 text-gray-400" />
                {vendor.phone}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500">Email</p>
              <p className="mt-1 flex items-center gap-2 text-sm text-gray-900">
                <Mail className="h-4 w-4 text-gray-400" />
                {vendor.email}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-gray-200/70 shadow-xs lg:col-span-2">
          <CardHeader className="border-b border-gray-200/70 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CreditCard className="h-4 w-4 text-pink-600" />
              Tax & Banking
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 p-4 sm:grid-cols-2 md:grid-cols-4">
            <InfoRow label="Tax ID (NPWP)" value={vendor.npwp} />
            <InfoRow label="Bank Name" value={vendor.bank_name} />
            <InfoRow label="Bank Account" value={vendor.bank_account} />
            <InfoRow label="Account Holder" value={vendor.bank_account_name} />
          </CardContent>
        </Card>

        {vendor.notes && (
          <Card className="border-gray-200/70 shadow-xs lg:col-span-2">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="text-base">Notes</CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <p className="text-sm text-gray-700">{vendor.notes}</p>
            </CardContent>
          </Card>
        )}
      </div>

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Deactivate Vendor?"
        description={`Are you sure you want to deactivate "${vendor.name}"?`}
        confirmLabel="Deactivate"
        cancelLabel="Cancel"
        loadingLabel="Deactivating..."
        loading={deactivateMutation.isPending}
        onConfirm={handleDeactivate}
      />
    </div>
  );
}
