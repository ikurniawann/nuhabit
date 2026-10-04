"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PurchasingPageHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { PurchasingTablePagination } from "@/features/purchasing/components/shared/purchasing-table-pagination";
import { PRODUCT_ROUTES } from "@/lib/purchasing/item-routes";
import { DollarSign, Eye, Filter, Loader2, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useVendorPriceList } from "../queries";
import { useDeleteVendorPriceList } from "../mutations";
import type { VendorPriceList } from "../types";
import { formatDate, formatNumber } from "@/lib/format";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

const STATUS_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

export function VendorPriceListPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(1);
  const limit = 10;

  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: VendorPriceList | null }>({
    open: false,
    item: null,
  });

  const listQuery = useVendorPriceList({
    search: search || undefined,
    status: statusFilter,
    page,
    limit,
  });

  const priceLists = listQuery.data?.data ?? [];
  const total = listQuery.data?.pagination.total ?? 0;
  const totalPages = listQuery.data?.pagination.total_pages ?? 1;
  const loading = listQuery.isLoading;

  const deleteMutation = useDeleteVendorPriceList();
  const isDeleting = deleteMutation.isPending;

  useEffect(() => {
    if (listQuery.isError) {
      toast.error(getErrorMessage(listQuery.error, "Failed to load price lists."));
    }
  }, [listQuery.isError, listQuery.error]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchQuery.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  const handleResetFilters = () => {
    setSearchQuery("");
    setSearch("");
    setStatusFilter("all");
    setPage(1);
  };

  const handleDelete = async () => {
    if (!deleteDialog.item || isDeleting) return;
    try {
      await deleteMutation.mutateAsync(deleteDialog.item.id);
      toast.success("Price list deleted successfully.");
      setDeleteDialog({ open: false, item: null });
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to delete price list."));
    }
  };

  const hasActiveFilters = search || statusFilter !== "all" || page > 1;

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title="Vendor Price Lists"
        description={`Manage product prices per vendor — ${total} total`}
        actions={
          <Link href={PRODUCT_ROUTES.purchasingPriceListInsert}>
            <Button className="purchasing-main-button w-full sm:w-auto">
              <Plus className="mr-2 h-4 w-4" />
              Add Price List
            </Button>
          </Link>
        }
      />

      <PurchasingListSection
        icon={DollarSign}
        title="Price List"
        description="Manage vendor prices per product, minimum order quantity, lead time, and validity period."
        toolbar={
          <div className="flex w-full flex-col gap-3 sm:w-auto md:flex-row md:items-center">
            <label className="relative w-full md:w-96">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="Search vendor, product, code, or price..."
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
              variant="outline"
              onClick={() => setFilterOpen((prev) => !prev)}
              className="h-10 flex-shrink-0 rounded-lg"
            >
              <Filter className="mr-2 h-4 w-4" />
              Filters
            </Button>
            {hasActiveFilters && (
              <Button variant="outline" onClick={handleResetFilters} className="h-10 flex-shrink-0 rounded-lg">
                Reset
              </Button>
            )}
          </div>
        }
      >
        {filterOpen && (
          <div className="border-b border-gray-200/70 px-4 py-4">
            <div className="grid grid-cols-1 gap-4 sm:max-w-xs">
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-gray-500">Status</p>
                <Combobox
                  options={STATUS_OPTIONS}
                  value={statusFilter}
                  onChange={(value) => {
                    setStatusFilter(value as "all" | "active" | "inactive");
                    setPage(1);
                  }}
                  placeholder="Select status..."
                  searchPlaceholder="Search..."
                  emptyMessage="No options"
                  className="h-9 text-sm"
                />
              </div>
            </div>
          </div>
        )}

        <div>
          {loading ? (
            <div className="py-12 text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" />
              <p className="mt-2 text-sm text-gray-500">Loading price lists...</p>
            </div>
          ) : priceLists.length === 0 ? (
            <div className="py-14 text-center">
              <DollarSign className="mx-auto mb-4 h-12 w-12 text-gray-300" />
              <p className="text-gray-500">
                {hasActiveFilters ? "No price lists match your filters" : "No price lists yet"}
              </p>
              {!hasActiveFilters && (
                <Link href={PRODUCT_ROUTES.purchasingPriceListInsert}>
                  <Button variant="outline" className="mt-4 purchasing-secondary-button">
                    Add First Price List
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
                      <th className="px-4 py-3 text-left font-semibold">Vendor</th>
                      <th className="px-4 py-3 text-left font-semibold">Product</th>
                      <th className="px-4 py-3 text-right font-semibold">Price</th>
                      <th className="px-4 py-3 text-right font-semibold">Minimum Qty</th>
                      <th className="px-4 py-3 text-left font-semibold">Lead Time</th>
                      <th className="px-4 py-3 text-left font-semibold">Validity</th>
                      <th className="px-4 py-3 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {priceLists.map((item) => (
                      <tr key={item.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{item.vendor?.name || "-"}</div>
                          <div className="text-sm text-gray-500">{item.vendor?.code || "-"}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{item.product?.nama || "-"}</div>
                          <div className="text-sm text-gray-500">{item.product?.kode || "-"}</div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="font-medium text-gray-900">{formatNumber(item.harga || 0)}</div>
                          <div className="text-xs text-gray-500">per {item.unit?.nama || "unit"}</div>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-700">
                          {item.minimum_qty} {item.unit?.nama}
                        </td>
                        <td className="px-4 py-3 text-gray-700">{item.lead_time_days} days</td>
                        <td className="px-4 py-3">
                          <div className="text-sm text-gray-700">{formatDate(item.berlaku_dari)}</div>
                          <div className="text-xs text-gray-500">to {formatDate(item.berlaku_sampai)}</div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Link href={PRODUCT_ROUTES.purchasingPriceListDetail(item.id)}>
                              <Button variant="ghost" size="sm" className="cursor-pointer" title="View detail">
                                <Eye className="h-4 w-4" />
                              </Button>
                            </Link>
                            <Link href={PRODUCT_ROUTES.purchasingPriceListEdit(item.id)}>
                              <Button variant="ghost" size="sm" className="cursor-pointer" title="Edit">
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </Link>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="cursor-pointer text-red-500 hover:text-red-600"
                              title="Delete"
                              onClick={() => setDeleteDialog({ open: true, item })}
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
                totalPages={totalPages}
                totalItems={total}
                pageSize={limit}
                onPageChange={setPage}
              />
            </>
          )}
        </div>
      </PurchasingListSection>

      <ConfirmDialog
        open={deleteDialog.open}
        onOpenChange={(open) => setDeleteDialog((prev) => ({ ...prev, open }))}
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
