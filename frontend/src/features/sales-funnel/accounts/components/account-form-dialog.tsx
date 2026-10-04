"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ORG_TYPE_LABELS } from "../../leads/types";
import { useCreateAccount, useUpdateAccount } from "../queries";
import { CustomFieldsSection } from "@/features/crm/custom-fields";

import { EMPTY_ACCOUNT_FORM, accountToForm, type AccountFormValues, type SalesAccount } from "../types";

interface AccountFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = tambah; terisi = edit */
  account: SalesAccount | null;
  onCreated?: (id?: string) => void;
}

/** EPIC-050 T-1.3 — form Account (instansi/perusahaan). */
export function AccountFormDialog({ open, onOpenChange, account, onCreated }: AccountFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        {open ? (
          <AccountFormBody key={account?.id ?? "new"} onOpenChange={onOpenChange} account={account} onCreated={onCreated} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function AccountFormBody({ onOpenChange, account, onCreated }: Omit<AccountFormDialogProps, "open">) {
  const [form, setForm] = useState<AccountFormValues>(() => (account ? accountToForm(account) : EMPTY_ACCOUNT_FORM));
  const isEdit = account !== null;

  const close = () => onOpenChange(false);
  const createMutation = useCreateAccount((id) => {
    close();
    onCreated?.(id);
  });
  const updateMutation = useUpdateAccount(close);
  const isPending = createMutation.isPending || updateMutation.isPending;

  const set = <K extends keyof AccountFormValues>(key: K, value: AccountFormValues[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const canSubmit = form.name.trim().length > 0;
  const handleSubmit = () => {
    if (!canSubmit || isPending) return;
    if (isEdit && account) updateMutation.mutate({ id: account.id, values: form });
    else createMutation.mutate(form);
  };

  return (
    <>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Account" : "Tambah Account"}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="acc_name">Nama Instansi / Perusahaan *</Label>
            <Input id="acc_name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="PT / Sekolah / Komunitas" />
          </div>
          <div className="space-y-1.5">
            <Label>Jenis</Label>
            <Select value={form.account_type} onValueChange={(v) => set("account_type", v as AccountFormValues["account_type"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(ORG_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acc_industry">Industri</Label>
            <Input id="acc_industry" value={form.industry} onChange={(e) => set("industry", e.target.value)} placeholder="cth. F&B, Pendidikan, Perbankan" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acc_city">Kota</Label>
            <Input id="acc_city" value={form.city} onChange={(e) => set("city", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acc_phone">Telepon kantor</Label>
            <Input id="acc_phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="0812… / 022…" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acc_email">Email</Label>
            <Input id="acc_email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acc_website">Website</Label>
            <Input id="acc_website" value={form.website} onChange={(e) => set("website", e.target.value)} placeholder="https://" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acc_npwp">NPWP</Label>
            <Input id="acc_npwp" value={form.npwp} onChange={(e) => set("npwp", e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="acc_address">Alamat</Label>
            <Textarea id="acc_address" rows={2} value={form.address} onChange={(e) => set("address", e.target.value)} />
          </div>
          <CustomFieldsSection object="account" values={form.custom ?? {}} onChange={(next) => set("custom", next)} />
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="acc_notes">Catatan</Label>
            <Textarea id="acc_notes" rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={isPending}>Batal</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || isPending}>
            {isPending ? "Menyimpan…" : isEdit ? "Simpan Perubahan" : "Tambah Account"}
          </Button>
        </DialogFooter>
    </>
  );
}
