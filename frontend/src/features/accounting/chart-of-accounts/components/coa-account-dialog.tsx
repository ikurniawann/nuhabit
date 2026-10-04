"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
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
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import {
  FormFieldLabel,
  formComboboxClassName,
  formInputClassName,
} from "@/components/layout/form-field";
import { CASH_FLOW_CATEGORIES } from "@/lib/accounting/coa-types";
import type { AccountTypeItem } from "@/features/accounting/account-types/types";
import { useCreateCoaAccount, useUpdateCoaAccount } from "../mutations";
import {
  coaPayload,
  isCoaFormComplete,
  parentCandidates,
  resolveFormCompanyId,
  type CoaForm,
} from "../coa-form";
import type { CoaAccountItem } from "../types";

const CASH_FLOW_OPTIONS = CASH_FLOW_CATEGORIES.map((c) => ({
  value: c,
  label: c,
}));

export type CoaDialogState = {
  editing: CoaAccountItem | null;
  initial: CoaForm;
} | null;

/** Dialog tambah/edit akun; form dipasang ulang tiap dibuka dari `state.initial`. */
export function CoaAccountDialog({
  state,
  onClose,
  accountTypes,
  allRows,
}: {
  state: CoaDialogState;
  onClose: () => void;
  accountTypes: AccountTypeItem[];
  allRows: CoaAccountItem[];
}) {
  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="md">
        {state ? (
          <CoaAccountForm
            editing={state.editing}
            initial={state.initial}
            onClose={onClose}
            accountTypes={accountTypes}
            allRows={allRows}
          />
        ) : null}
      </DialogPanel>
    </Dialog>
  );
}

function CoaAccountForm({
  editing,
  initial,
  onClose,
  accountTypes,
  allRows,
}: {
  editing: CoaAccountItem | null;
  initial: CoaForm;
  onClose: () => void;
  accountTypes: AccountTypeItem[];
  allRows: CoaAccountItem[];
}) {
  const [form, setForm] = useState(initial);
  const createMutation = useCreateCoaAccount();
  const updateMutation = useUpdateCoaAccount();
  const isSaving = createMutation.isPending || updateMutation.isPending;

  const accountTypeFormOptions = useMemo(
    () =>
      accountTypes.map((t) => ({
        value: t.id,
        label: `${t.code} — ${t.name}`,
      })),
    [accountTypes],
  );

  // Parent harus satu company_id dengan akun yang dibuat/diedit (Sulu).
  const parentFormOptions = useMemo(() => {
    const companyId = resolveFormCompanyId(editing, form.parent_id, allRows);
    return parentCandidates(allRows, editing?.id ?? null, companyId).map(
      (p) => ({
        value: p.id,
        label: `${p.code_display || p.code} — ${p.name}`,
      }),
    );
  }, [allRows, editing, form.parent_id]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (isSaving) return;
    if (!isCoaFormComplete(form)) {
      toast.error("Kode, nama, dan account type wajib diisi");
      return;
    }
    const payload = coaPayload(form);
    try {
      const res = editing
        ? await updateMutation.mutateAsync({ id: editing.id, ...payload })
        : await createMutation.mutateAsync(payload);
      toast.success(
        res.message ||
          (editing ? "Akun berhasil diperbarui" : "Akun berhasil ditambahkan"),
      );
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan");
    }
  }

  const cashFlowOptions = CASH_FLOW_OPTIONS;

  return (
    <DialogPanelForm onSubmit={handleSave}>
      <DialogPanelHeader>
        <DialogPanelTitle>
          {editing ? "Edit Akun" : "Tambah Akun"}
        </DialogPanelTitle>
        <DialogPanelDescription>
          Kode compact 7 digit (contoh 1101001) atau format spasi.
        </DialogPanelDescription>
      </DialogPanelHeader>
      <DialogPanelBody className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-1">
          <FormFieldLabel required>Kode</FormFieldLabel>
          <Input
            value={form.code}
            onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
            className={formInputClassName}
            placeholder="1 1 01 001"
            required
          />
        </div>
        <div className="space-y-1.5 sm:col-span-1">
          <FormFieldLabel required>Account Type</FormFieldLabel>
          <Combobox
            options={accountTypeFormOptions}
            value={form.account_type_id}
            onChange={(value) =>
              setForm((f) => ({ ...f, account_type_id: value }))
            }
            placeholder="Pilih type"
            searchPlaceholder="Cari type..."
            emptyMessage="Type tidak ditemukan"
            className={formComboboxClassName}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <FormFieldLabel required>Nama</FormFieldLabel>
          <Input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className={formInputClassName}
            required
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <FormFieldLabel>Parent</FormFieldLabel>
          <Combobox
            options={parentFormOptions}
            value={form.parent_id}
            onChange={(value) => setForm((f) => ({ ...f, parent_id: value }))}
            placeholder="— Root —"
            searchPlaceholder="Cari parent..."
            emptyMessage="Parent tidak ditemukan"
            allowClear
            className={formComboboxClassName}
          />
        </div>
        <div className="space-y-1.5">
          <FormFieldLabel>Cash Flow Category</FormFieldLabel>
          <Combobox
            options={cashFlowOptions}
            value={form.cash_flow_category}
            onChange={(value) =>
              setForm((f) => ({ ...f, cash_flow_category: value }))
            }
            placeholder="—"
            searchPlaceholder="Cari kategori..."
            emptyMessage="Kategori tidak ditemukan"
            allowClear
            className={formComboboxClassName}
          />
        </div>
        <div className="space-y-1.5">
          <FormFieldLabel>Deskripsi</FormFieldLabel>
          <Input
            value={form.description}
            onChange={(e) =>
              setForm((f) => ({ ...f, description: e.target.value }))
            }
            className={formInputClassName}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={form.is_contra}
            onCheckedChange={(v) =>
              setForm((f) => ({ ...f, is_contra: Boolean(v) }))
            }
          />
          Contra account
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={form.is_cash_bank}
            onCheckedChange={(v) =>
              setForm((f) => ({ ...f, is_cash_bank: Boolean(v) }))
            }
          />
          Kas / Bank
        </label>
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
          onClick={onClose}
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
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Simpan"}
        </Button>
      </DialogFooter>
    </DialogPanelForm>
  );
}
