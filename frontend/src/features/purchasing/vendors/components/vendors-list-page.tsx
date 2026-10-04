"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Combobox } from "@/components/ui/combobox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PurchasingPageHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { PurchasingTablePagination } from "@/features/purchasing/components/shared/purchasing-table-pagination";
import { PRODUCT_ROUTES } from "@/lib/purchasing/item-routes";
import { Building2, Eye, Filter, Loader2, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useVendorList } from "../queries";
import { useDeactivateVendor, useUpdateVendor } from "../mutations";
import {
  VENDOR_CATEGORY_OPTIONS,
  VENDOR_USAGE_OPTIONS,
  getVendorCategoryLabel,
  getVendorUsageLabel,
  type Vendor,
  type VendorCategory,
  type VendorUsageScope,
} from "../types";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

const STATUS_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

const CATEGORY_FILTER_OPTIONS = [
  { value: "all", label: "All Categories" },
  ...VENDOR_CATEGORY_OPTIONS,
];

const USAGE_FILTER_OPTIONS = [
  { value: "all", label: "Semua Peruntukan" },
  ...VENDOR_USAGE_OPTIONS,
];

export function VendorsListPage() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [categoryFilter, setCategoryFilter] = useState<VendorCategory | "all">("all");
  const [usageFilter, setUsageFilter] = useState<VendorUsageScope | "all">("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(1);
  const limit = 10;

  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; vendor: Vendor | null }>({
    open: false,
    vendor: null,
  });
  const [statusDialog, setStatusDialog] = useState<{
    open: boolean;
    vendor: Vendor | null;
    nextStatus: boolean;
  }>({
    open: false,
    vendor: null,
    nextStatus: true,
  });

  const listQuery = useVendorList({
    search: search || undefined,
    status: statusFilter,
    category: categoryFilter,
    usage_scope: usageFilter,
    page,
    limit,
  });

  const vendors = listQuery.data?.data ?? [];
  const total = listQuery.data?.pagination.total ?? 0;
  const totalPages = listQuery.data?.pagination.total_pages ?? 1;
  const loading = listQuery.isLoading;

  const deactivateMutation = useDeactivateVendor();
  const statusMutation = useUpdateVendor();
  const deleteLoading = deactivateMutation.isPending;
  const statusUpdatingId = statusMutation.isPending ? statusMutation.variables?.id ?? null : null;

  useEffect(() => {
    if (listQuery.isError) {
      toast.error(getErrorMessage(listQuery.error, "Failed to load vendors"));
    }
  }, [listQuery.isError, listQuery.error]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchQuery.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  const isFilterActive =
    statusFilter !== "all" || categoryFilter !== "all" || usageFilter !== "all";

  const handleResetFilters = () => {
    setSearchQuery("");
    setSearch("");
    setStatusFilter("all");
    setCategoryFilter("all");
    setUsageFilter("all");
    setPage(1);
  };

  const handleDelete = async () => {
    const vendor = deleteDialog.vendor;
    if (!vendor || deleteLoading) return;
    try {
      await deactivateMutation.mutateAsync(vendor.id);
      toast.success(`Vendor "${vendor.name}" deactivated successfully`);
      setDeleteDialog({ open: false, vendor: null });
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to deactivate vendor"));
    }
  };

  const handleConfirmToggleStatus = async () => {
    const vendor = statusDialog.vendor;
    if (!vendor || statusMutation.isPending) return;
    try {
      await statusMutation.mutateAsync({
        id: vendor.id,
        payload: { is_active: statusDialog.nextStatus },
      });
      toast.success(`Vendor ${statusDialog.nextStatus ? "activated" : "deactivated"} successfully`);
      setStatusDialog({ open: false, vendor: null, nextStatus: true });
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to update vendor status"));
    }
  };

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title="Vendors"
        description={`Manage vendor master data for product purchasing — ${total} total`}
        actions={
          <Link href={PRODUCT_ROUTES.purchasingVendorInsert}>
            <Button className="purchasing-main-button w-full sm:w-auto">
              <Plus className="mr-2 h-4 w-4" />
              Add Vendor
            </Button>
          </Link>
        }
      />

      <PurchasingListSection
        icon={Building2}
        title="Vendor List"
        description="Review vendor code, category, contact person, phone, email, and active status."
        toolbar={
          <div className="flex w-full flex-col gap-3 sm:w-auto md:flex-row md:items-center">
            <label className="relative w-full md:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="Search vendor code, name, or contact..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 bg-white pl-10 pr-10 text-sm focus:border-pink-400 focus:ring-2 focus:ring-pink-100"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-700"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </label>

            <Button
              type="button"
              variant="outline"
              onClick={() => setFilterOpen((open) => !open)}
              className={
                isFilterActive
                  ? "h-10 gap-2 rounded-lg border-pink-600 bg-pink-600 px-3 text-sm font-semibold !text-white shadow-sm hover:!border-pink-700 hover:!bg-pink-700 hover:!text-white"
                  : "h-10 gap-2 rounded-lg border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 shadow-sm hover:!border-pink-200 hover:!bg-pink-50 hover:!text-pink-700"
              }
            >
              <Filter className="h-4 w-4" />
              Filter
            </Button>

            {(search || isFilterActive || page > 1) && (
              <Button variant="outline" onClick={handleResetFilters} className="h-10 shrink-0 rounded-lg">
                Reset
              </Button>
            )}
          </div>
        }
      >
        <div>
          {filterOpen && (
            <div className="border-b border-gray-100 bg-gray-50/70 px-5 py-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Status
                  </div>
                  <Combobox
                    options={STATUS_OPTIONS}
                    value={statusFilter}
                    onChange={(value) => {
                      setStatusFilter(value as typeof statusFilter);
                      setPage(1);
                    }}
                    placeholder="Filter by status..."
                    className="!w-full h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Category
                  </div>
                  <Combobox
                    options={CATEGORY_FILTER_OPTIONS}
                    value={categoryFilter}
                    onChange={(value) => {
                      setCategoryFilter(value as VendorCategory | "all");
                      setPage(1);
                    }}
                    placeholder="Filter by category..."
                    className="!w-full h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Peruntukan
                  </div>
                  <Combobox
                    options={USAGE_FILTER_OPTIONS}
                    value={usageFilter}
                    onChange={(value) => {
                      setUsageFilter(value as VendorUsageScope | "all");
                      setPage(1);
                    }}
                    placeholder="Filter peruntukan..."
                    className="!w-full h-9 text-sm"
                  />
                </div>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-gray-500">
              <Loader2 className="mr-2 h-5 w-5 animate-spin text-pink-600" />
              Loading vendors...
            </div>
          ) : vendors.length === 0 ? (
            <div className="py-14 text-center">
              <Building2 className="mx-auto mb-4 h-12 w-12 text-gray-300" />
              <p className="text-gray-500">
                {search || isFilterActive ? "No vendors match the current filters" : "No vendors yet"}
              </p>
              {!search && !isFilterActive && (
                <Link href={PRODUCT_ROUTES.purchasingVendorInsert}>
                  <Button variant="outline" className="purchasing-secondary-button mt-4">
                    Add First Vendor
                  </Button>
                </Link>
              )}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">Code</th>
                      <th className="px-4 py-3 text-left font-semibold">Vendor Name</th>
                      <th className="px-4 py-3 text-left font-semibold">Category</th>
                      <th className="px-4 py-3 text-left font-semibold">Peruntukan</th>
                      <th className="px-4 py-3 text-left font-semibold">Contact Person</th>
                      <th className="px-4 py-3 text-left font-semibold">Phone</th>
                      <th className="px-4 py-3 text-center font-semibold">Active</th>
                      <th className="px-4 py-3 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {vendors.map((vendor) => (
                      <tr
                        key={vendor.id}
                        className="cursor-pointer hover:bg-gray-50"
                        onClick={() => router.push(PRODUCT_ROUTES.purchasingVendorDetail(vendor.id))}
                      >
                        <td className="px-4 py-3 font-medium text-gray-900">{vendor.code}</td>
                        <td className="px-4 py-3">
                          <Link
                            href={PRODUCT_ROUTES.purchasingVendorDetail(vendor.id)}
                            className="font-medium text-pink-700 hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {vendor.name}
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline">{getVendorCategoryLabel(vendor.category)}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            className={
                              vendor.usage_scope === "fnb"
                                ? "border-0 bg-amber-100 text-amber-700"
                                : vendor.usage_scope === "operasional"
                                  ? "border-0 bg-blue-100 text-blue-700"
                                  : "border-0 bg-emerald-100 text-emerald-700"
                            }
                          >
                            {getVendorUsageLabel(vendor.usage_scope)}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-gray-700">{vendor.contact_person}</td>
                        <td className="px-4 py-3 text-gray-600">{vendor.phone}</td>
                        <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                          <Switch
                            checked={vendor.is_active}
                            disabled={statusUpdatingId === vendor.id}
                            onCheckedChange={(checked) =>
                              setStatusDialog({ open: true, vendor, nextStatus: checked })
                            }
                            aria-label={`Toggle active status for ${vendor.name}`}
                          />
                        </td>
                        <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            <Link href={PRODUCT_ROUTES.purchasingVendorDetail(vendor.id)}>
                              <Button variant="ghost" size="sm" title="View detail" className="cursor-pointer">
                                <Eye className="h-4 w-4" />
                              </Button>
                            </Link>
                            <Link href={PRODUCT_ROUTES.purchasingVendorEdit(vendor.id)}>
                              <Button variant="ghost" size="sm" title="Edit vendor" className="cursor-pointer">
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </Link>
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Deactivate vendor"
                              className="cursor-pointer text-red-500 hover:text-red-600"
                              onClick={() => setDeleteDialog({ open: true, vendor })}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <PurchasingTablePagination
                page={page}
                totalPages={Math.max(1, totalPages)}
                totalItems={total}
                pageSize={limit}
                onPageChange={setPage}
              />
            </>
          )}
        </div>
      </PurchasingListSection>

      <ConfirmDialog
        open={statusDialog.open}
        onOpenChange={(open) => {
          if (!open && !statusUpdatingId) {
            setStatusDialog({ open: false, vendor: null, nextStatus: true });
          }
        }}
        variant="default"
        title={statusDialog.nextStatus ? "Activate Vendor?" : "Deactivate Vendor?"}
        description={`Are you sure you want to ${
          statusDialog.nextStatus ? "activate" : "deactivate"
        } "${statusDialog.vendor?.name ?? ""}"?`}
        confirmLabel={statusDialog.nextStatus ? "Activate" : "Deactivate"}
        cancelLabel="Cancel"
        loading={Boolean(statusUpdatingId)}
        onConfirm={handleConfirmToggleStatus}
      />

      <ConfirmDialog
        open={deleteDialog.open}
        onOpenChange={(open) => !open && setDeleteDialog({ open: false, vendor: null })}
        title="Deactivate Vendor?"
        description={`Are you sure you want to deactivate "${deleteDialog.vendor?.name ?? ""}"?`}
        confirmLabel="Deactivate"
        cancelLabel="Cancel"
        loadingLabel="Deactivating..."
        loading={deleteLoading}
        onConfirm={handleDelete}
      />
    </div>
  );
}
