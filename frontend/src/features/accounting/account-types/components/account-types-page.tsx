"use client";

import { useMemo, useState } from "react";
import { TagIcon, PlusIcon } from "@heroicons/react/24/outline";
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
import {
  FormFieldLabel,
  formInputClassName,
} from "@/components/layout/form-field";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { MasterDeleteDialog } from "@/features/master-data/components/master-delete-dialog";
import { MasterTableActions } from "@/features/master-data/components/master-table-actions";
import { useAccountTypeList } from "../queries";
import {
  useCreateAccountType,
  useUpdateAccountType,
  useDeleteAccountType,
} from "../mutations";
import type { AccountTypeItem } from "../types";
import { useDebouncedSearch } from "@/features/accounting/shared/use-debounced-search";
import { toast } from "sonner";

type FormState = {
  name: string;
  code: string;
  normal_balance: "DEBIT" | "CREDIT";
  sort_order: number;
  is_active: boolean;
};

const EMPTY_FORM: FormState = {
  name: "",
  code: "",
  normal_balance: "DEBIT",
  sort_order: 0,
  is_active: true,
};

export function AccountTypesPage() {
  const { query: searchQuery, setQuery: setSearchQuery, search } = useDebouncedSearch();
  const [dialog, setDialog] = useState<"add" | "edit" | null>(null);
  const [selected, setSelected] = useState<AccountTypeItem | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data, isLoading } = useAccountTypeList();
  const createMutation = useCreateAccountType();
  const updateMutation = useUpdateAccountType();
  const deleteMutation = useDeleteAccountType();

  const rows = useMemo(() => data ?? [], [data]);
  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isDeleting = deleteMutation.isPending;


  const filtered = useMemo(() => {
    if (!search) return rows;
    const q = search.toLowerCase();
    return rows.filter(
      (d) =>
        d.name.toLowerCase().includes(q) || d.code.toLowerCase().includes(q)
    );
  }, [rows, search]);

  function openAdd() {
    setForm(EMPTY_FORM);
    setSelected(null);
    setDialog("add");
  }

  function openEdit(item: AccountTypeItem) {
    setSelected(item);
    setForm({
      name: item.name,
      code: item.code,
      normal_balance: item.normal_balance,
      sort_order: item.sort_order,
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
        const res = await updateMutation.mutateAsync({
          id: selected.id,
          ...form,
        });
        toast.success(res.message || "Account type berhasil diperbarui");
      } else {
        const res = await createMutation.mutateAsync(form);
        toast.success(res.message || "Account type berhasil ditambahkan");
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
      toast.success("Account type berhasil dihapus");
      setDeleteId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menghapus");
    }
  }

  return (
    <div className="space-y-6">

      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Account Types</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Klasifikasi akun (Asset, Liability, …) — {rows.length} tipe
          </p>
        </div>
        <Button
          type="button"
          onClick={openAdd}
          className="h-10 w-full gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 sm:w-auto"
        >
          <PlusIcon className="h-4 w-4" />
          Tambah Type
        </Button>
      </div>

      <PurchasingListSection
        icon={TagIcon}
        title="Daftar Account Types"
        description="Lookup tipe akun yang dipakai Chart of Accounts."
        toolbar={
          <label className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Cari nama atau kode..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-10 bg-card pl-9 pr-9 text-sm focus:border-primary/40 focus:ring-1 focus:ring-primary/30"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
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
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand-text" />
            <p className="mt-2 text-sm text-muted-foreground">Memuat data...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-14 text-center">
            <TagIcon className="mx-auto mb-4 h-12 w-12 text-muted-foreground/40" />
            <p className="text-muted-foreground">
              {search ? "Tidak ada data yang cocok" : "Belum ada account type"}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto px-4">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-gray-200/70 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-3">Kode</th>
                  <th className="px-3 py-3">Nama</th>
                  <th className="px-3 py-3">Normal Balance</th>
                  <th className="px-3 py-3">Urutan</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <TableRow
                    key={item.id}
                    className="border-b border-gray-200/70 hover:bg-muted/40"
                  >
                    <td className="px-3 py-3 font-mono text-xs font-semibold">
                      {item.code}
                    </td>
                    <td className="px-3 py-3 font-medium text-foreground">
                      {item.name}
                    </td>
                    <td className="px-3 py-3">
                      <Badge variant="outline" className="border-gray-200/80">
                        {item.normal_balance}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {item.sort_order}
                    </td>
                    <td className="px-3 py-3">
                      <Badge
                        variant="outline"
                        className={
                          item.is_active
                            ? "border-emerald-200/80 text-emerald-700"
                            : "border-gray-200/80 text-muted-foreground"
                        }
                      >
                        {item.is_active ? "Aktif" : "Nonaktif"}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-right">
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

      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <DialogPanel size="sm">
          <DialogPanelForm onSubmit={handleSave}>
            <DialogPanelHeader>
              <DialogPanelTitle>
                {dialog === "edit" ? "Edit Account Type" : "Tambah Account Type"}
              </DialogPanelTitle>
              <DialogPanelDescription>
                Tipe akun menentukan normal balance default.
              </DialogPanelDescription>
            </DialogPanelHeader>
            <DialogPanelBody className="space-y-4">
              <div className="space-y-1.5">
                <FormFieldLabel required>Kode</FormFieldLabel>
                <Input
                  value={form.code}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))
                  }
                  className={formInputClassName}
                  placeholder="ASSET"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <FormFieldLabel required>Nama</FormFieldLabel>
                <Input
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                  className={formInputClassName}
                  placeholder="Asset"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <FormFieldLabel required>Normal Balance</FormFieldLabel>
                <select
                  value={form.normal_balance}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      normal_balance: e.target.value as "DEBIT" | "CREDIT",
                    }))
                  }
                  className={formInputClassName}
                >
                  <option value="DEBIT">DEBIT</option>
                  <option value="CREDIT">CREDIT</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <FormFieldLabel>Urutan</FormFieldLabel>
                <Input
                  type="number"
                  value={form.sort_order}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      sort_order: Number(e.target.value) || 0,
                    }))
                  }
                  className={formInputClassName}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.is_active}
                  onCheckedChange={(v) =>
                    setForm((f) => ({ ...f, is_active: Boolean(v) }))
                  }
                />
                Aktif
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
                className="h-10 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {isSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Simpan"
                )}
              </Button>
            </DialogFooter>
          </DialogPanelForm>
        </DialogPanel>
      </Dialog>

      <MasterDeleteDialog
        open={Boolean(deleteId)}
        title="Hapus Account Type?"
        description="Type yang masih dipakai COA tidak dapat dihapus."
        isDeleting={isDeleting}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
