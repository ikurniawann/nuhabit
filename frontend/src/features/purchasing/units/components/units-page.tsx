"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { PurchasingPageHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { PurchasingTablePagination } from "@/features/purchasing/components/shared/purchasing-table-pagination";
import { Loader2, Pencil, Plus, Scale, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { Unit } from "@/types/purchasing";
import { useUnitList } from "../queries";
import { useUpdateUnitStatus, useDeleteUnit } from "../mutations";
import { UnitFormDialog } from "./unit-form-dialog";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

const TYPE_BADGE_STYLES: Record<string, string> = {
  BESAR: "border-blue-200 bg-blue-50 text-blue-700",
  KECIL: "border-emerald-200 bg-emerald-50 text-emerald-700",
  KONVERSI: "border-purple-200 bg-purple-50 text-purple-700",
};

const TYPE_LABELS: Record<string, string> = {
  BESAR: "Satuan Besar",
  KECIL: "Satuan Kecil",
  KONVERSI: "Satuan Konversi",
};

export function UnitsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const limit = 10;

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null);
  const [deletingUnit, setDeletingUnit] = useState<Unit | null>(null);
  const [dialogKey, setDialogKey] = useState(0);
  const [statusDialog, setStatusDialog] = useState<{
    open: boolean;
    unit: Unit | null;
    nextStatus: boolean;
  }>({
    open: false,
    unit: null,
    nextStatus: true,
  });

  const listQuery = useUnitList({ search: search || undefined, page, limit });
  const units = listQuery.data?.data ?? [];
  const total = listQuery.data?.pagination.total ?? 0;
  const totalPages = listQuery.data?.pagination.total_pages ?? 1;
  const loading = listQuery.isLoading;

  const statusMutation = useUpdateUnitStatus();
  const deleteMutation = useDeleteUnit();
  const isDeleting = deleteMutation.isPending;
  const statusUpdatingId = statusMutation.isPending
    ? statusMutation.variables?.id ?? null
    : null;

  useEffect(() => {
    if (listQuery.isError) {
      console.error("Error loading units:", listQuery.error);
      toast.error(`Gagal memuat satuan: ${getErrorMessage(listQuery.error, "Kesalahan tidak diketahui")}`);
    }
  }, [listQuery.isError, listQuery.error]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchQuery.trim());
      setPage(1);
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  const openDialog = (unit: Unit | null) => {
    setEditingUnit(unit);
    setDialogKey((k) => k + 1);
    setIsDialogOpen(true);
  };
  const handleOpenAdd = () => openDialog(null);
  const handleOpenEdit = (unit: Unit) => openDialog(unit);

  const handleOpenDelete = (unit: Unit) => {
    setDeletingUnit(unit);
    setIsDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingUnit || isDeleting) return;

    try {
      await deleteMutation.mutateAsync(deletingUnit.id);
      toast.success("Satuan berhasil dihapus");
      setIsDeleteDialogOpen(false);
      setDeletingUnit(null);
    } catch (error: unknown) {
      console.error("Error deleting unit:", error);
      toast.error(getErrorMessage(error, "Gagal menghapus satuan"));
    }
  };

  const handleConfirmToggleStatus = async () => {
    const unit = statusDialog.unit;
    if (!unit || statusMutation.isPending) return;

    try {
      await statusMutation.mutateAsync({ id: unit.id, isActive: statusDialog.nextStatus });
      toast.success(`Satuan berhasil ${statusDialog.nextStatus ? "diaktifkan" : "dinonaktifkan"}`);
      setStatusDialog({ open: false, unit: null, nextStatus: true });
    } catch (error: unknown) {
      console.error("Error updating unit status:", error);
      toast.error(getErrorMessage(error, "Gagal memperbarui status satuan"));
    }
  };

  const handleResetSearch = () => {
    setSearchQuery("");
    setSearch("");
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title="Data Master Satuan"
        description={`Manage measurement units for raw materials and products — ${total} total`}
        actions={
          <Button onClick={handleOpenAdd} className="purchasing-main-button w-full sm:w-auto">
            <Plus className="mr-2 h-4 w-4" />
            Tambah Satuan
          </Button>
        }
      />

      <PurchasingListSection
        icon={Scale}
        title="Daftar Satuan"
        description="Tinjau kode, nama, tipe, deskripsi, dan status aktif satuan."
        toolbar={
          <div className="flex w-full flex-col gap-3 sm:w-auto md:flex-row md:items-center">
            <label className="relative w-full md:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="Cari kode atau nama..."
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
            {(search || page > 1) && (
              <Button variant="outline" onClick={handleResetSearch} className="h-10 shrink-0 rounded-lg">
                Atur Ulang
              </Button>
            )}
          </div>
        }
      >
        <div>
          {loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-gray-500">
              <Loader2 className="mr-2 h-5 w-5 animate-spin text-pink-600" />
              Memuat satuan...
            </div>
          ) : units.length === 0 ? (
            <div className="py-14 text-center">
              <Scale className="mx-auto mb-4 h-12 w-12 text-gray-300" />
              <p className="text-gray-500">
                {search ? "Tidak ada satuan yang cocok dengan pencarian" : "Belum ada satuan"}
              </p>
              {!search && (
                <Button variant="outline" onClick={handleOpenAdd} className="purchasing-secondary-button mt-4">
                  Tambah Satuan Pertama
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">Kode</th>
                      <th className="px-4 py-3 text-left font-semibold">Nama</th>
                      <th className="px-4 py-3 text-left font-semibold">Tipe</th>
                      <th className="px-4 py-3 text-left font-semibold">Deskripsi</th>
                      <th className="px-4 py-3 text-center font-semibold">Aktif</th>
                      <th className="px-4 py-3 text-right font-semibold">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {units.map((unit) => (
                      <tr key={unit.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <span className="font-medium text-gray-900">{unit.kode}</span>
                        </td>
                        <td className="px-4 py-3 text-gray-700">{unit.nama}</td>
                        <td className="px-4 py-3">
                          <Badge
                            variant="outline"
                            className={TYPE_BADGE_STYLES[unit.tipe] || "border-gray-200 bg-gray-50 text-gray-700"}
                          >
                            {TYPE_LABELS[unit.tipe] || unit.tipe}
                          </Badge>
                        </td>
                        <td className="max-w-[320px] truncate px-4 py-3 text-gray-600">
                          {unit.deskripsi || "-"}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center">
                            <Switch
                              checked={unit.is_active}
                              disabled={statusUpdatingId === unit.id}
                              onCheckedChange={(checked) =>
                                setStatusDialog({ open: true, unit, nextStatus: checked })
                              }
                              aria-label={`Ubah status aktif ${unit.nama}`}
                            />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="cursor-pointer"
                              title="Ubah"
                              onClick={() => handleOpenEdit(unit)}
                            >
                              <Pencil className="h-4 w-4 text-gray-600" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="cursor-pointer text-red-500 hover:text-red-600"
                              title="Hapus"
                              onClick={() => handleOpenDelete(unit)}
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

      <UnitFormDialog
        key={dialogKey}
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        editingUnit={editingUnit}
      />

      <ConfirmDialog
        open={statusDialog.open}
        onOpenChange={(open) => {
          if (!open && !statusUpdatingId) {
            setStatusDialog({ open: false, unit: null, nextStatus: true });
          }
        }}
        variant="default"
        title={statusDialog.nextStatus ? "Aktifkan Satuan?" : "Nonaktifkan Satuan?"}
        description={`Yakin ingin ${
          statusDialog.nextStatus ? "mengaktifkan" : "menonaktifkan"
        } satuan "${statusDialog.unit?.nama ?? ""}"?`}
        confirmLabel={statusDialog.nextStatus ? "Aktifkan" : "Nonaktifkan"}
        cancelLabel="Batal"
        loading={Boolean(statusUpdatingId)}
        onConfirm={handleConfirmToggleStatus}
      />

      <ConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        title="Hapus Satuan?"
        description={`Yakin ingin menghapus satuan "${
          deletingUnit?.nama ?? ""
        }"? Data akan disembunyikan dari daftar. Satuan yang sudah dipakai bahan baku tidak dapat dihapus.`}
        confirmLabel="Hapus"
        cancelLabel="Batal"
        loadingLabel="Menghapus..."
        loading={isDeleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
