"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PRODUCT_ROUTES } from "@/lib/purchasing/item-routes";
import {
  ArrowLeft,
  Edit,
  Trash2,
  DollarSign,
  Package,
  Truck,
  CalendarDays,
  Star,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { useVendorPriceListDetail } from "../queries";
import { useDeleteVendorPriceList } from "../mutations";
import { formatDate, formatNumber } from "@/lib/format";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function VendorPriceListDetailPage({ id: idProp }: { id?: string }) {
  const params = useParams();
  const router = useRouter();
  const priceListId = idProp || (params.id as string);

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const priceListQuery = useVendorPriceListDetail(priceListId);
  const priceList = priceListQuery.data ?? null;
  const loading = priceListQuery.isLoading;
  const deleteMutation = useDeleteVendorPriceList();
  const isDeleting = deleteMutation.isPending;

  const handleDelete = async () => {
    if (!priceList || isDeleting) return;
    try {
      await deleteMutation.mutateAsync(priceList.id);
      toast.success("Price list deleted successfully.");
      setIsDeleteDialogOpen(false);
      router.push(PRODUCT_ROUTES.purchasingPriceList);
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to delete price list."));
    }
  };

  const unitName = priceList?.unit?.nama || "unit";

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-pink-600" />
      </div>
    );
  }

  if (!priceList) {
    return <div className="py-12 text-center text-red-500">Price list not found.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900">{priceList.vendor?.name}</h1>
            {priceList.is_preferred && (
              <Badge className="bg-blue-100 text-blue-800">Preferred</Badge>
            )}
            {!priceList.is_active && (
              <Badge variant="outline" className="border-gray-200/80 text-gray-600">
                Inactive
              </Badge>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-500">
            <span>{priceList.product?.nama || "-"}</span>
            <span className="text-gray-300">•</span>
            <span className="rounded-md bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-700">
              {priceList.product?.kode || "-"}
            </span>
            <span className="text-gray-300">•</span>
            <span>{formatNumber(priceList.harga || 0)}</span>
          </div>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Link href={PRODUCT_ROUTES.purchasingPriceList}>
            <Button variant="outline" className="purchasing-secondary-button w-full sm:w-auto">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </Link>
          <Link href={PRODUCT_ROUTES.purchasingPriceListEdit(priceList.id)}>
            <Button variant="outline" className="purchasing-secondary-button w-full sm:w-auto">
              <Edit className="mr-2 h-4 w-4" />
              Edit
            </Button>
          </Link>
          <Button
            variant="outline"
            onClick={() => setIsDeleteDialogOpen(true)}
            className="h-10 w-full rounded-lg border-red-200 bg-white px-3 text-sm font-medium text-red-600 shadow-sm hover:!border-red-200 hover:!bg-red-50 hover:!text-red-700 sm:w-auto"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-lg bg-pink-50 p-2">
              <DollarSign className="h-5 w-5 text-pink-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Unit Price</p>
              <p className="text-lg font-semibold text-gray-900">{formatNumber(priceList.harga)}</p>
              <p className="text-xs text-gray-500">per {unitName}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-lg bg-blue-50 p-2">
              <Package className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Minimum Quantity</p>
              <p className="text-lg font-semibold text-gray-900">
                {priceList.minimum_qty} {unitName}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-lg bg-amber-50 p-2">
              <Truck className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Lead Time</p>
              <p className="text-lg font-semibold text-gray-900">{priceList.lead_time_days} days</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-lg bg-green-50 p-2">
              <Star className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Priority</p>
              <p className="text-lg font-semibold text-gray-900">
                {priceList.is_preferred ? "Preferred" : "Regular"}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-gray-200/70 shadow-xs">
          <CardHeader className="border-b border-gray-200/70 pb-3">
            <CardTitle className="text-base">Vendor Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-4 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-gray-500">Vendor Code</span>
              <span className="font-medium text-gray-900">{priceList.vendor?.code || "-"}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-gray-500">Contact Person</span>
              <span className="font-medium text-gray-900">{priceList.vendor?.contact_person || "-"}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-gray-500">Phone</span>
              <span className="font-medium text-gray-900">{priceList.vendor?.phone || "-"}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-gray-500">Email</span>
              <span className="font-medium text-gray-900">{priceList.vendor?.email || "-"}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-gray-200/70 shadow-xs">
          <CardHeader className="border-b border-gray-200/70 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="h-4 w-4" />
              Validity Period
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-4 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-gray-500">Effective From</span>
              <span className="font-medium text-gray-900">{formatDate(priceList.berlaku_dari)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-gray-500">Effective Until</span>
              <span className="font-medium text-gray-900">{formatDate(priceList.berlaku_sampai)}</span>
            </div>
            {priceList.catatan && (
              <div className="border-t border-gray-200/70 pt-3">
                <p className="text-gray-500">Notes</p>
                <p className="mt-1 text-gray-900">{priceList.catatan}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        title="Delete Price List?"
        description="Are you sure you want to delete this price list? This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        loadingLabel="Deleting..."
        loading={isDeleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
