"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { BuildingOfficeIcon, PlusIcon } from "@heroicons/react/24/outline";
import { Loader2, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelForm,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  FormFieldLabel,
  formInputClassName,
} from "@/components/layout/form-field";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { MasterDeleteDialog } from "../../components/master-delete-dialog";
import { MasterTableActions } from "../../components/master-table-actions";
import { useDepartmentList } from "../queries";
import {
  useCreateDepartment,
  useUpdateDepartment,
  useDeleteDepartment,
} from "../mutations";
import type { DepartmentItem } from "../types";

const EMPTY_FORM = { name: "", code: "", description: "", is_active: true };

export function DepartmentsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [dialog, setDialog] = useState<"add" | "edit" | null>(null);
  const [selected, setSelected] = useState<DepartmentItem | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data, isLoading } = useDepartmentList();
  const createMutation = useCreateDepartment();
  const updateMutation = useUpdateDepartment();
  const deleteMutation = useDeleteDepartment();

  const rows = useMemo(() => data ?? [], [data]);
  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isDeleting = deleteMutation.isPending;

  const search = useDeferredValue(searchQuery.trim());

  const filtered = useMemo(() => {
    if (!search) return rows;
    const q = search.toLowerCase();
    return rows.filter(
      (d) => d.name.toLowerCase().includes(q) || d.code.toLowerCase().includes(q)
    );
  }, [rows, search]);

  function openAdd() {
    setForm(EMPTY_FORM);
    setSelected(null);
    setDialog("add");
  }

  function openEdit(item: DepartmentItem) {
    setSelected(item);
    setForm({
      name: item.name,
      code: item.code,
      description: item.description || "",
      is_active: item.is_active,
    });
    setDialog("edit");
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (isSaving) return;
    if (!form.name.trim() || !form.code.trim()) {
      toast.error("Nama dan kode wajib diisi");
      return;
    }
    try {
      if (dialog === "edit" && selected) {
        const res = await updateMutation.mutateAsync({ id: selected.id, ...form });
        toast.success(res.message || "Departemen berhasil diperbarui");
      } else {
        const res = await createMutation.mutateAsync(form);
        toast.success(res.message || "Departemen berhasil ditambahkan");
      }
      setDialog(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan");
    }
  }

  async function handleDelete() {
    if (!deleteId || isDeleting) return;
    try {
      await deleteMutation.mutateAsync(deleteId);
      toast.success("Departemen berhasil dihapus");
      setDeleteId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menghapus");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Master Departemen</h1>
          <p className="mt-1 text-sm text-gray-500">
            Struktur organisasi perusahaan — {rows.length} departemen terdaftar
          </p>
        </div>
        <Button
          type="button"
          onClick={openAdd}
          className="h-10 w-full gap-2 rounded-lg bg-pink-600 px-3 text-sm font-semibold text-white shadow-sm hover:bg-pink-700 sm:w-auto"
        >
          <PlusIcon className="h-4 w-4" />
          Tambah Departemen
        </Button>
      </div>

      <PurchasingListSection
        icon={BuildingOfficeIcon}
        title="Daftar Departemen"
        description="Kelola divisi dan unit kerja yang digunakan di data karyawan."
        toolbar={
          <label className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Cari nama atau kode..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-10 bg-white pl-9 pr-9 text-sm focus:border-pink-400 focus:ring-2 focus:ring-pink-100"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                aria-label="Hapus pencarian"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </label>
        }
      >
        {isLoading ? (
          <div className="py-14 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" />
            <p className="mt-2 text-sm text-gray-500">Memuat data departemen...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-14 text-center">
            <BuildingOfficeIcon className="mx-auto mb-4 h-12 w-12 text-gray-300" />
            <p className="text-gray-500">
              {search ? "Tidak ada departemen yang cocok" : "Belum ada departemen"}
            </p>
            {!search ? (
              <Button
                type="button"
                variant="outline"
                onClick={openAdd}
                className="mt-4 h-10 rounded-lg border-pink-200 text-pink-700 hover:bg-pink-50"
              >
                Tambah Departemen Pertama
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="overflow-x-auto px-4 pb-4">
            <table className="w-full text-sm">
              <thead>
                <TableRow className="border-b border-gray-200/70 bg-gray-50/80 text-xs uppercase tracking-wide text-gray-500 hover:bg-gray-50/80">
                  <th className="px-4 py-3 text-left font-semibold">Nama</th>
                  <th className="px-4 py-3 text-left font-semibold">Kode</th>
                  <th className="px-4 py-3 text-left font-semibold">Deskripsi</th>
                  <th className="px-4 py-3 text-left font-semibold">Status</th>
                  <th className="px-4 py-3 text-right font-semibold">Aksi</th>
                </TableRow>
              </thead>
              <tbody className="divide-y divide-gray-200/50">
                {filtered.map((item) => (
                  <TableRow key={item.id} className="hover:bg-gray-50/80">
                    <td className="px-4 py-3 font-medium text-gray-900">{item.name}</td>
                    <td className="px-4 py-3">
                      <span className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs">
                        {item.code}
                      </span>
                    </td>
                    <td className="max-w-xs truncate px-4 py-3 text-gray-500">
                      {item.description || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        className={
                          item.is_active
                            ? "border-0 bg-emerald-100 font-normal text-emerald-700"
                            : "border-0 bg-gray-100 font-normal text-gray-500"
                        }
                      >
                        {item.is_active ? "Aktif" : "Nonaktif"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <MasterTableActions
                        onEdit={() => openEdit(item)}
                        onDelete={() => setDeleteId(item.id)}
                      />
                    </td>
                  </TableRow>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PurchasingListSection>

      <Dialog open={!!dialog} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogPanel size="sm">
          <DialogPanelForm onSubmit={handleSave}>
            <DialogPanelHeader>
              <DialogPanelTitle>
                {dialog === "edit" ? "Edit Departemen" : "Tambah Departemen"}
              </DialogPanelTitle>
              <DialogPanelDescription>
                Data departemen digunakan untuk penempatan karyawan dan jabatan.
              </DialogPanelDescription>
            </DialogPanelHeader>
            <DialogPanelBody className="space-y-4">
              <div>
                <FormFieldLabel required>Nama Departemen</FormFieldLabel>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Contoh: Human Resources"
                  className={formInputClassName}
                />
              </div>
              <div>
                <FormFieldLabel required>Kode</FormFieldLabel>
                <Input
                  value={form.code}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))
                  }
                  placeholder="Contoh: HR"
                  maxLength={20}
                  className={formInputClassName}
                />
                <p className="mt-1 text-xs text-gray-400">Kode unik, huruf kapital otomatis</p>
              </div>
              <div>
                <FormFieldLabel>Deskripsi</FormFieldLabel>
                <Input
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Opsional"
                  className={formInputClassName}
                />
              </div>
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={form.is_active}
                  onCheckedChange={(checked) =>
                    setForm((f) => ({ ...f, is_active: checked === true }))
                  }
                />
                <span className="text-sm text-gray-700">Aktif</span>
              </label>
            </DialogPanelBody>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialog(null)}
                disabled={isSaving}
                className="h-10 rounded-lg border-gray-200/80"
              >
                Batal
              </Button>
              <Button
                type="submit"
                disabled={isSaving}
                className="h-10 gap-2 rounded-lg bg-pink-600 px-4 text-white hover:bg-pink-700"
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {isSaving ? "Menyimpan..." : "Simpan"}
              </Button>
            </DialogFooter>
          </DialogPanelForm>
        </DialogPanel>
      </Dialog>

      <MasterDeleteDialog
        open={!!deleteId}
        title="Hapus Departemen?"
        description="Departemen yang masih digunakan karyawan tidak dapat dihapus."
        isDeleting={isDeleting}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
