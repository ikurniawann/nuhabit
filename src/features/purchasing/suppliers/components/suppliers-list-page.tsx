"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PurchasingPageHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { PurchasingTablePagination } from "@/features/purchasing/components/shared/purchasing-table-pagination";
import { RM_ROUTES } from "@/lib/purchasing/item-routes";
import { BuildingOfficeIcon } from "@heroicons/react/24/outline";
import { Download, Eye, Filter, Loader2, Pencil, Plus, Search, Trash2, Upload, X } from "lucide-react";
import {
  Supplier,
  SupplierListParams,
  PaymentTerms,
} from "@/types/supplier";
import { useSupplierList } from "../queries";
import { useDeleteSupplier, useUpdateSupplierStatus } from "../mutations";
import { PaymentTermsBadge, PaymentTermsBadgeFilter } from "./payment-terms-badge";
import PurchasingGuard from "@/features/purchasing/components/shared/purchasing-guard";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { downloadExport } from "@/lib/purchasing/api-client/download";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function SuppliersListPage() {
  return (
    <PurchasingGuard minRole="purchasing_staff">
      <SuppliersListInner />
    </PurchasingGuard>
  );
}

function SuppliersListInner() {
  const { user } = useAuth();
  const router = useRouter();

  const [search, setSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive" | "draft">("all");
  const [paymentFilter, setPaymentFilter] = useState<PaymentTerms | "all">("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(1);
  const limit = 10;

  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; supplier: Supplier | null }>({
    open: false,
    supplier: null,
  });
  const [statusDialog, setStatusDialog] = useState<{
    open: boolean;
    supplier: Supplier | null;
    nextStatus: boolean;
  }>({
    open: false,
    supplier: null,
    nextStatus: true,
  });
  const [exporting, setExporting] = useState(false);

  const listParams: SupplierListParams = {
    search: search || undefined,
    status: statusFilter === "all" ? undefined : statusFilter,
    payment_terms: paymentFilter === "all" ? undefined : paymentFilter,
    page,
    limit,
    sort_by: "nama_supplier",
    sort_dir: "ASC",
  };

  const listQuery = useSupplierList(listParams);
  const suppliers = listQuery.data?.data ?? [];
  const total = listQuery.data?.pagination.total ?? 0;
  const totalPages = listQuery.data?.pagination.totalPages ?? 1;
  const loading = listQuery.isLoading;

  const deleteMutation = useDeleteSupplier();
  const statusMutation = useUpdateSupplierStatus();
  const deleteLoading = deleteMutation.isPending;
  const statusUpdatingId = statusMutation.isPending
    ? statusMutation.variables?.id ?? null
    : null;

  useEffect(() => {
    if (listQuery.isError) {
      toast.error(`Gagal memuat data supplier: ${getErrorMessage(listQuery.error, "Kesalahan tidak diketahui")}`);
    }
  }, [listQuery.isError, listQuery.error]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchQuery.trim());
      setPage(1);
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  async function handleDelete() {
    const supplier = deleteDialog.supplier;
    if (!supplier || deleteLoading) return;

    try {
      await deleteMutation.mutateAsync(supplier.id);
      toast.success(`Supplier "${supplier.nama_supplier}" berhasil dihapus.`);
      setDeleteDialog({ open: false, supplier: null });
    } catch (err: unknown) {
      toast.error(`Gagal menghapus supplier: ${getErrorMessage(err, "Kesalahan tidak diketahui")}`);
    }
  }

  async function handleConfirmToggleStatus() {
    const supplier = statusDialog.supplier;
    if (!supplier || statusMutation.isPending) return;

    try {
      await statusMutation.mutateAsync({ id: supplier.id, isActive: statusDialog.nextStatus });
      toast.success(`Supplier berhasil ${statusDialog.nextStatus ? "diaktifkan" : "dinonaktifkan"}.`);
      setStatusDialog({ open: false, supplier: null, nextStatus: true });
    } catch (err: unknown) {
      toast.error(`Gagal memperbarui status: ${getErrorMessage(err, "Kesalahan tidak diketahui")}`);
    }
  }

  async function handleExport() {
    if (exporting) return;

    setExporting(true);
    try {
      await downloadExport(
        "/api/purchasing/export/suppliers",
        `suppliers-${new Date().toISOString().split("T")[0]}.xlsx`
      );

      toast.success("Supplier berhasil diekspor ke Excel.");
    } catch (err: unknown) {
      toast.error(`Gagal mengekspor: ${getErrorMessage(err, "Kesalahan tidak diketahui")}`);
    } finally {
      setExporting(false);
    }
  }

  function handleResetFilters() {
    setSearchQuery("");
    setSearch("");
    setStatusFilter("all");
    setPaymentFilter("all");
    setPage(1);
  }

  const canManageSuppliers = ["admin", "super_admin", "purchasing_admin", "purchasing_manager", "purchasing_staff"].includes(user?.role ?? "");
  const isFilterActive = statusFilter !== "all" || paymentFilter !== "all";

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title="Supplier"
        description={`Kelola vendor dan data supplier — total ${total}`}
        actions={
          canManageSuppliers ? (
            <>
              <Link href={RM_ROUTES.purchasingSuppliersImport}>
                <Button
                  variant="outline"
                  className="purchasing-secondary-button w-full sm:w-auto"
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Impor
                </Button>
              </Link>
              <Link href={RM_ROUTES.purchasingSuppliersInsert}>
                <Button className="purchasing-main-button w-full sm:w-auto">
                  <Plus className="mr-2 h-4 w-4" />
                  Tambah Supplier
                </Button>
              </Link>
            </>
          ) : undefined
        }
      />

      <PurchasingListSection
        icon={BuildingOfficeIcon}
        title="Daftar Supplier"
        description="Kelola vendor, termin pembayaran, status aktif, dan narahubung supplier."
        toolbar={
          <div className="flex w-full flex-col gap-3 sm:w-auto md:flex-row md:items-center">
            <label className="relative w-full md:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="Cari supplier..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 bg-white pl-10 pr-10 text-sm focus:border-pink-400 focus:ring-2 focus:ring-pink-100"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-700"
                  aria-label="Bersihkan pencarian"
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
                  ? "h-10 gap-2 rounded-lg border-pink-600 bg-pink-600 px-3 text-sm font-semibold !text-white shadow-sm hover:!border-pink-700 hover:!bg-pink-700 hover:!text-white [&_*]:!text-white [&_svg]:!text-white"
                  : "h-10 gap-2 rounded-lg border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 shadow-sm hover:!border-pink-200 hover:!bg-pink-50 hover:!text-pink-700"
              }
            >
              <Filter className={isFilterActive ? "h-4 w-4 text-white" : "h-4 w-4"} />
              Filter
              {isFilterActive && (
                <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white/20 px-1.5 text-xs text-white">
                  {[statusFilter !== "all", paymentFilter !== "all"].filter(Boolean).length}
                </span>
              )}
            </Button>

            <Button
              variant="outline"
              onClick={handleExport}
              disabled={exporting}
              title="Ekspor Excel"
              className="purchasing-secondary-button w-full sm:w-auto"
            >
              {exporting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Ekspor
            </Button>

            {(search || isFilterActive || page > 1) && (
              <Button variant="outline" onClick={handleResetFilters} className="h-10 flex-shrink-0 rounded-lg">
                Atur Ulang
              </Button>
            )}
          </div>
        }
      >
        <div>
          {filterOpen && (
            <div className="border-b border-gray-100 bg-gray-50/70 px-5 py-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <Filter className="h-3.5 w-3.5 text-pink-500" />
                    Status
                  </div>
                  <Combobox
                    options={[
                      { value: "all", label: "Semua Status" },
                      { value: "active", label: "Aktif" },
                      { value: "inactive", label: "Nonaktif" },
                      { value: "draft", label: "Draft" },
                    ]}
                    value={statusFilter}
                    onChange={(value) => {
                      setStatusFilter(value as typeof statusFilter);
                      setPage(1);
                    }}
                    placeholder="Filter berdasarkan status..."
                    searchPlaceholder="Cari status..."
                    emptyMessage="Status tidak ditemukan"
                    className="!w-full h-9 text-sm"
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <Filter className="h-3.5 w-3.5 text-pink-500" />
                    Termin Pembayaran
                  </div>
                  <PaymentTermsBadgeFilter
                    value={paymentFilter}
                    onChange={(next) => {
                      setPaymentFilter(next);
                      setPage(1);
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" />
              <p className="mt-2 text-sm text-gray-500">Memuat supplier...</p>
            </div>
          ) : suppliers.length === 0 ? (
            <div className="py-14 text-center">
              <BuildingOfficeIcon className="mx-auto mb-4 h-12 w-12 text-gray-300" />
              <p className="text-gray-500">
                {search ? "Tidak ada supplier yang cocok dengan pencarian" : "Belum ada supplier"}
              </p>
              {canManageSuppliers && !search && (
                <Link href={RM_ROUTES.purchasingSuppliersInsert}>
                  <Button variant="outline" className="mt-4 purchasing-secondary-button">
                    Tambah Supplier Pertama
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
                      <th className="w-12 px-4 py-3 text-left font-semibold">No.</th>
                      <th className="px-4 py-3 text-left font-semibold">Kode</th>
                      <th className="px-4 py-3 text-left font-semibold">Nama Supplier</th>
                      <th className="px-4 py-3 text-left font-semibold">Kota</th>
                      <th className="px-4 py-3 text-left font-semibold">Narahubung & Telepon</th>
                      <th className="px-4 py-3 text-left font-semibold">Termin Pembayaran</th>
                      <th className="px-4 py-3 text-center font-semibold">Status</th>
                      {canManageSuppliers && <th className="px-4 py-3 text-right font-semibold">Aksi</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {suppliers.map((supplier, idx) => (
                      <tr
                        key={supplier.id}
                        className="cursor-pointer hover:bg-gray-50"
                        onClick={() => router.push(RM_ROUTES.purchasingSuppliersDetail(supplier.id))}
                      >
                        <td className="px-4 py-3 text-sm text-gray-400">
                          {(page - 1) * limit + idx + 1}
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-medium text-gray-900">{supplier.kode}</span>
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900">{supplier.nama_supplier}</td>
                        <td className="px-4 py-3 text-gray-600">{supplier.kota ?? "-"}</td>
                        <td className="px-4 py-3">
                          <div className="text-gray-700">
                            {supplier.pic_name ?? <span className="text-gray-400">-</span>}
                          </div>
                          {supplier.pic_phone && (
                            <div className="text-xs text-gray-500">{supplier.pic_phone}</div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <PaymentTermsBadge value={supplier.payment_terms} />
                        </td>
                        <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-center">
                            <Switch
                              checked={supplier.is_active}
                              disabled={statusUpdatingId === supplier.id}
                              onCheckedChange={(checked) =>
                                setStatusDialog({ open: true, supplier, nextStatus: checked })
                              }
                              aria-label={`Ubah status ${supplier.nama_supplier}`}
                            />
                          </div>
                        </td>
                        {canManageSuppliers && (
                          <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-2">
                              <Link href={RM_ROUTES.purchasingSuppliersDetail(supplier.id)}>
                                <Button variant="ghost" size="sm" title="Detail" className="cursor-pointer">
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </Link>
                              {(supplier.is_active || supplier.status === "draft") && (
                                <Link href={RM_ROUTES.purchasingSuppliersEdit(supplier.id)}>
                                  <Button variant="ghost" size="sm" title="Ubah" className="cursor-pointer">
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                </Link>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Hapus"
                                className="cursor-pointer text-red-500 hover:text-red-600"
                                onClick={() => setDeleteDialog({ open: true, supplier })}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </td>
                        )}
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
            setStatusDialog({ open: false, supplier: null, nextStatus: true });
          }
        }}
        variant="default"
        title={statusDialog.nextStatus ? "Aktifkan Supplier?" : "Nonaktifkan Supplier?"}
        description={`Apakah Anda yakin ingin ${statusDialog.nextStatus ? "mengaktifkan" : "menonaktifkan"} "${statusDialog.supplier?.nama_supplier ?? ""}"?`}
        confirmLabel={statusDialog.nextStatus ? "Aktifkan" : "Nonaktifkan"}
        cancelLabel="Batal"
        loadingLabel="Menyimpan..."
        loading={Boolean(statusUpdatingId)}
        onConfirm={handleConfirmToggleStatus}
      />

      <ConfirmDialog
        open={deleteDialog.open}
        onOpenChange={(open) => !open && setDeleteDialog({ open: false, supplier: null })}
        title="Hapus Supplier?"
        description={`Apakah Anda yakin ingin menghapus "${deleteDialog.supplier?.nama_supplier ?? ""}"? Data akan disembunyikan dari daftar, bukan dinonaktifkan.`}
        confirmLabel="Hapus"
        cancelLabel="Batal"
        loadingLabel="Menghapus..."
        loading={deleteLoading}
        onConfirm={handleDelete}
      />
    </div>
  );
}
