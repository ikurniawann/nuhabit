"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { ITEMS_RAW_MATERIALS_PATH, RM_ROUTES } from "@/lib/purchasing/item-routes";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { PurchasingTablePagination } from "@/features/purchasing/components/shared/purchasing-table-pagination";
import {
  AlertCircle,
  CheckCircle2,
  Filter,
  Loader2,
  Package,
  PackageX,
  Plus,
  Search,
  Upload,
  Download,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { downloadExport } from "@/lib/purchasing/api-client/download";
import { RawMaterialWithStock, MaterialCategory } from "@/types/purchasing";
import { useRawMaterialList, useRawMaterialCategoryOptions } from "../queries";
import { useDeleteRawMaterial, useUpdateRawMaterialStatus } from "../mutations";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  buildLookupLabelMap,
  resolveCategoryLabel,
  toLookupOptions,
} from "../master-lookups";
import { formatNumber } from "@/lib/format";
import { RawMaterialsTable } from "./raw-materials-table";

const STATUS_OPTIONS = [
  { value: "all", label: "Semua Status Stok" },
  { value: "below_minimum", label: "Stok Menipis atau Habis" },
];

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function RawMaterialsPage() {
  const [page, setPage] = useState(1);
  const limit = 10;
  const [searchQuery, setSearchQuery] = useState("");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<MaterialCategory | "all">("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingMaterial, setDeletingMaterial] = useState<RawMaterialWithStock | null>(null);
  const [statusDialog, setStatusDialog] = useState<{
    open: boolean;
    material: RawMaterialWithStock | null;
    nextStatus: boolean;
  }>({
    open: false,
    material: null,
    nextStatus: true,
  });
  const [exporting, setExporting] = useState(false);

  const listQuery = useRawMaterialList({
    search: search || undefined,
    kategori: categoryFilter === "all" ? undefined : categoryFilter,
    below_minimum: statusFilter === "below_minimum",
    page,
    limit,
    sort_by: "nama",
    sort_dir: "ASC",
  });
  const categoriesQuery = useRawMaterialCategoryOptions();
  const categoryMap = buildLookupLabelMap(categoriesQuery.data);
  const categoryFilterOptions = [
    { value: "all", label: "Semua Kategori" },
    ...toLookupOptions(categoriesQuery.data),
  ];
  const materials = listQuery.data?.data ?? [];
  const loading = listQuery.isLoading;
  const total = listQuery.data?.pagination.total ?? 0;
  const totalPages = listQuery.data?.pagination.total_pages ?? 1;
  const stockSummary = listQuery.data?.summary ?? {
    total: 0,
    aman: 0,
    menipis: 0,
    habis: 0,
  };

  const deleteMutation = useDeleteRawMaterial();
  const statusMutation = useUpdateRawMaterialStatus();
  const isDeleting = deleteMutation.isPending;
  const statusUpdatingId = statusMutation.isPending ? statusMutation.variables?.id ?? null : null;

  useEffect(() => {
    if (listQuery.isError) {
      console.error("Error loading materials:", listQuery.error);
      toast.error(`Gagal memuat bahan baku: ${getErrorMessage(listQuery.error, "Kesalahan tidak diketahui")}`);
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
    setCategoryFilter("all");
    setStatusFilter("all");
    setPage(1);
  };

  const isFilterActive = categoryFilter !== "all" || statusFilter !== "all";
  const activeFilterCount = Number(categoryFilter !== "all") + Number(statusFilter !== "all");

  const handleConfirmToggleStatus = async () => {
    const material = statusDialog.material;
    if (!material || statusMutation.isPending) return;

    try {
      await statusMutation.mutateAsync({ id: material.id, isActive: statusDialog.nextStatus });
      toast.success(`Bahan baku berhasil ${statusDialog.nextStatus ? "diaktifkan" : "dinonaktifkan"}.`);
      setStatusDialog({ open: false, material: null, nextStatus: true });
    } catch (error: unknown) {
      console.error("Error updating raw material status:", error);
      toast.error(`Gagal memperbarui status: ${getErrorMessage(error, "Kesalahan tidak diketahui")}`);
    }
  };

  const handleOpenDelete = (material: RawMaterialWithStock) => {
    setDeletingMaterial(material);
    setDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingMaterial || isDeleting) return;

    try {
      await deleteMutation.mutateAsync(deletingMaterial.id);
      toast.success("Bahan baku berhasil dihapus.");
      setDeleteDialogOpen(false);
      setDeletingMaterial(null);
    } catch (error: unknown) {
      console.error("Error deleting raw material:", error);
      toast.error(`Gagal menghapus bahan baku: ${getErrorMessage(error, "Kesalahan tidak diketahui")}`);
    }
  };

  const handleExport = async () => {
    if (exporting) return;

    setExporting(true);
    try {
      await downloadExport(
        "/api/purchasing/export/raw-materials",
        `raw-materials-${new Date().toISOString().split("T")[0]}.xlsx`
      );

      toast.success("Bahan baku berhasil diekspor ke Excel.");
    } catch (error: unknown) {
      console.error("Error exporting raw materials:", error);
      toast.error(`Gagal mengekspor: ${getErrorMessage(error, "Kesalahan tidak diketahui")}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Data Master Bahan Baku</h1>
          <p className="mt-1 text-sm text-gray-500">
            Kelola data bahan baku, kategori, pemetaan COA, dan indikator stok — {total} data
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Link href={RM_ROUTES.materialsImport}>
            <Button
              variant="outline"
              className="purchasing-secondary-button w-full sm:w-auto"
            >
              <Upload className="mr-2 h-4 w-4" />
              Impor
            </Button>
          </Link>
          <Link href={`${ITEMS_RAW_MATERIALS_PATH}/insert`}>
            <Button className="purchasing-main-button w-full sm:w-auto">
              <Plus className="mr-2 h-4 w-4" />
              Tambah Bahan Baku
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          {
            label: "Total Bahan",
            value: stockSummary.total,
            className: "text-gray-900",
            iconWrap: "bg-primary/10 text-brand-text",
            icon: Package,
          },
          {
            label: "Stok Aman",
            value: stockSummary.aman,
            className: "text-emerald-700",
            iconWrap: "bg-emerald-50 text-emerald-600",
            icon: CheckCircle2,
          },
          {
            label: "Stok Menipis",
            value: stockSummary.menipis,
            className: "text-amber-700",
            iconWrap: "bg-amber-50 text-amber-600",
            icon: AlertCircle,
          },
          {
            label: "Stok Habis",
            value: stockSummary.habis,
            className: "text-red-700",
            iconWrap: "bg-red-50 text-red-600",
            icon: PackageX,
          },
        ].map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label} className="border-gray-200/70 shadow-xs">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <span
                    className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${stat.iconWrap}`}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-500">{stat.label}</p>
                    <p className={`mt-0.5 text-2xl font-bold tabular-nums ${stat.className}`}>
                      {formatNumber(stat.value)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <PurchasingListSection
        icon={Package}
        title="Daftar Bahan Baku"
        description="Tinjau kode bahan, kategori, pemetaan COA, stok tersedia, harga rata-rata, dan status aktif."
        toolbar={
          <div className="flex w-full flex-col gap-3 sm:w-auto md:flex-row md:items-center">
            <label className="relative w-full md:w-96">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="Cari kode, nama, atau kategori..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 bg-white pl-10 pr-10 text-sm focus:border-pink-400 focus:ring-2 focus:ring-pink-100"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-700"
                  aria-label="Hapus pencarian"
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
                  {activeFilterCount}
                </span>
              )}
            </Button>

            <Button
              type="button"
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
              <Button variant="outline" onClick={handleResetFilters} className="h-10 shrink-0 rounded-lg">
                Atur Ulang
              </Button>
            )}
          </div>
        }
      >
        <div>
          {filterOpen && (
            <div className="border-b border-gray-200/70 bg-gray-50/70 px-5 py-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <Filter className="h-3.5 w-3.5 text-pink-500" />
                    Kategori
                  </div>
                  <Combobox
                    options={categoryFilterOptions}
                    value={categoryFilter}
                    onChange={(value) => {
                      setCategoryFilter(value as MaterialCategory | "all");
                      setPage(1);
                    }}
                    placeholder="Filter kategori..."
                    searchPlaceholder="Cari kategori..."
                    emptyMessage="Kategori tidak ditemukan"
                    className="w-full! h-9 text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <AlertCircle className="h-3.5 w-3.5 text-pink-500" />
                    Status Stok
                  </div>
                  <Combobox
                    options={STATUS_OPTIONS}
                    value={statusFilter}
                    onChange={(value) => {
                      setStatusFilter(value);
                      setPage(1);
                    }}
                    placeholder="Filter status stok..."
                    searchPlaceholder="Cari status stok..."
                    emptyMessage="Status stok tidak ditemukan"
                    className="w-full! h-9 text-sm"
                  />
                </div>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-gray-500">
              <Loader2 className="mr-2 h-5 w-5 animate-spin text-pink-600" />
              Memuat bahan baku...
            </div>
          ) : materials.length === 0 ? (
            <div className="py-14 text-center">
              <Package className="mx-auto mb-4 h-12 w-12 text-gray-300" />
              <p className="text-gray-500">
                {search || isFilterActive
                  ? "Tidak ada bahan baku yang cocok dengan filter"
                  : "Belum ada bahan baku"}
              </p>
              {!search && !isFilterActive && (
                <Link href={`${ITEMS_RAW_MATERIALS_PATH}/insert`}>
                  <Button variant="outline" className="purchasing-secondary-button mt-4">
                    Tambah Bahan Baku Pertama
                  </Button>
                </Link>
              )}
            </div>
          ) : (
            <>
              <RawMaterialsTable
                materials={materials}
                categoryLabel={(kategori) => resolveCategoryLabel(kategori, categoryMap)}
                statusUpdatingId={statusUpdatingId}
                onToggleStatus={(material, nextStatus) => setStatusDialog({ open: true, material, nextStatus })}
                onDelete={handleOpenDelete}
              />

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
            setStatusDialog({ open: false, material: null, nextStatus: true });
          }
        }}
        variant="default"
        title={statusDialog.nextStatus ? "Aktifkan Bahan Baku?" : "Nonaktifkan Bahan Baku?"}
        description={`Yakin ingin ${
          statusDialog.nextStatus ? "mengaktifkan" : "menonaktifkan"
        } "${statusDialog.material?.nama ?? ""}"?`}
        confirmLabel={statusDialog.nextStatus ? "Aktifkan" : "Nonaktifkan"}
        cancelLabel="Batal"
        loading={Boolean(statusUpdatingId)}
        onConfirm={handleConfirmToggleStatus}
      />

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Hapus Bahan Baku?"
        description={`Yakin ingin menghapus "${deletingMaterial?.nama ?? ""}"? Data akan disembunyikan dari daftar. Bahan yang masih punya stok atau dipakai di Bill of Materials tidak dapat dihapus.`}
        confirmLabel="Hapus"
        cancelLabel="Batal"
        loadingLabel="Menghapus..."
        loading={isDeleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
