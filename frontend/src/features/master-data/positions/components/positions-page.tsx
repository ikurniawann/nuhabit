"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { BriefcaseIcon, PlusIcon } from "@heroicons/react/24/outline";
import { Loader2, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
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
  formComboboxClassName,
  formInputClassName,
} from "@/components/layout/form-field";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { useDepartmentList } from "@/features/master-data/departments";
import { MasterDeleteDialog } from "../../components/master-delete-dialog";
import { MasterTableActions } from "../../components/master-table-actions";
import { usePositionList } from "../queries";
import {
  useCreatePosition,
  useUpdatePosition,
  useDeletePosition,
} from "../mutations";
import type { PositionItem } from "../types";

const LEVEL_OPTIONS = [
  "Staff",
  "Senior Staff",
  "Supervisor",
  "Assistant Manager",
  "Manager",
  "Senior Manager",
  "General Manager",
  "Director",
  "C-Level",
].map((level) => ({ value: level, label: level }));

const EMPTY_FORM = { title: "", department_name: "", level: "Staff", is_active: true };

export function PositionsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [dialog, setDialog] = useState<"add" | "edit" | null>(null);
  const [selected, setSelected] = useState<PositionItem | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: positions, isLoading } = usePositionList();
  const { data: departments } = useDepartmentList();
  const createMutation = useCreatePosition();
  const updateMutation = useUpdatePosition();
  const deleteMutation = useDeletePosition();

  const rows = useMemo(() => positions ?? [], [positions]);
  const departmentOptions = useMemo(
    () => (departments ?? []).map((d) => ({ value: d.name, label: d.name })),
    [departments]
  );
  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isDeleting = deleteMutation.isPending;

  const search = useDeferredValue(searchQuery.trim());

  const filtered = useMemo(() => {
    if (!search) return rows;
    const q = search.toLowerCase();
    return rows.filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        (d.department || "").toLowerCase().includes(q) ||
        (d.level || "").toLowerCase().includes(q)
    );
  }, [rows, search]);

  function openAdd() {
    setForm(EMPTY_FORM);
    setSelected(null);
    setDialog("add");
  }

  function openEdit(item: PositionItem) {
    setSelected(item);
    setForm({
      title: item.title,
      department_name: item.department || "",
      level: item.level || "Staff",
      is_active: item.is_active,
    });
    setDialog("edit");
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (isSaving) return;
    if (!form.title.trim()) {
      toast.error("Nama jabatan wajib diisi");
      return;
    }
    const payload = {
      title: form.title.trim(),
      department: form.department_name,
      level: form.level,
      is_active: form.is_active,
    };
    try {
      if (dialog === "edit" && selected) {
        const res = await updateMutation.mutateAsync({ id: selected.id, ...payload });
        toast.success(res.message || "Jabatan berhasil diperbarui");
      } else {
        const res = await createMutation.mutateAsync(payload);
        toast.success(res.message || "Jabatan berhasil ditambahkan");
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
      toast.success("Jabatan berhasil dihapus");
      setDeleteId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menghapus");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Master Jabatan</h1>
          <p className="mt-1 text-sm text-gray-500">
            Daftar posisi/jabatan per departemen — {rows.length} jabatan terdaftar
          </p>
        </div>
        <Button
          type="button"
          onClick={openAdd}
          className="h-10 w-full gap-2 rounded-lg bg-pink-600 px-3 text-sm font-semibold text-white shadow-sm hover:bg-pink-700 sm:w-auto"
        >
          <PlusIcon className="h-4 w-4" />
          Tambah Jabatan
        </Button>
      </div>

      <PurchasingListSection
        icon={BriefcaseIcon}
        title="Daftar Jabatan"
        description="Kelola jabatan yang dapat dipilih saat input data karyawan."
        toolbar={
          <label className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Cari jabatan atau departemen..."
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
            <p className="mt-2 text-sm text-gray-500">Memuat data jabatan...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-14 text-center">
            <BriefcaseIcon className="mx-auto mb-4 h-12 w-12 text-gray-300" />
            <p className="text-gray-500">
              {search ? "Tidak ada jabatan yang cocok" : "Belum ada jabatan"}
            </p>
            {!search ? (
              <Button
                type="button"
                variant="outline"
                onClick={openAdd}
                className="mt-4 h-10 rounded-lg border-pink-200 text-pink-700 hover:bg-pink-50"
              >
                Tambah Jabatan Pertama
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="overflow-x-auto px-4 pb-4">
            <table className="w-full text-sm">
              <thead>
                <TableRow className="border-b border-gray-200/70 bg-gray-50/80 text-xs uppercase tracking-wide text-gray-500 hover:bg-gray-50/80">
                  <th className="px-4 py-3 text-left font-semibold">Nama Jabatan</th>
                  <th className="px-4 py-3 text-left font-semibold">Departemen</th>
                  <th className="px-4 py-3 text-left font-semibold">Level</th>
                  <th className="px-4 py-3 text-left font-semibold">Status</th>
                  <th className="px-4 py-3 text-right font-semibold">Aksi</th>
                </TableRow>
              </thead>
              <tbody className="divide-y divide-gray-200/50">
                {filtered.map((item) => (
                  <TableRow key={item.id} className="hover:bg-gray-50/80">
                    <td className="px-4 py-3 font-medium text-gray-900">{item.title}</td>
                    <td className="px-4 py-3 text-gray-600">{item.department || "—"}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-pink-50 px-2 py-0.5 text-xs font-medium text-pink-700">
                        {item.level || "—"}
                      </span>
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
                {dialog === "edit" ? "Edit Jabatan" : "Tambah Jabatan"}
              </DialogPanelTitle>
              <DialogPanelDescription>
                Jabatan dikaitkan dengan departemen untuk penempatan karyawan.
              </DialogPanelDescription>
            </DialogPanelHeader>
            <DialogPanelBody className="space-y-4">
              <div>
                <FormFieldLabel required>Nama Jabatan</FormFieldLabel>
                <Input
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Contoh: HR Manager"
                  className={formInputClassName}
                />
              </div>
              <div>
                <FormFieldLabel>Departemen</FormFieldLabel>
                <Combobox
                  options={departmentOptions}
                  value={form.department_name}
                  onChange={(value) => setForm((f) => ({ ...f, department_name: value }))}
                  placeholder="Pilih departemen"
                  searchPlaceholder="Cari departemen..."
                  emptyMessage="Departemen tidak ditemukan"
                  allowClear
                  className={formComboboxClassName}
                />
              </div>
              <div>
                <FormFieldLabel>Level</FormFieldLabel>
                <Combobox
                  options={LEVEL_OPTIONS}
                  value={form.level}
                  onChange={(value) => setForm((f) => ({ ...f, level: value || "Staff" }))}
                  placeholder="Pilih level"
                  searchPlaceholder="Cari level..."
                  emptyMessage="Level tidak ditemukan"
                  className={formComboboxClassName}
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
        title="Hapus Jabatan?"
        description="Jabatan yang masih digunakan karyawan tidak dapat dihapus."
        isDeleting={isDeleting}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
