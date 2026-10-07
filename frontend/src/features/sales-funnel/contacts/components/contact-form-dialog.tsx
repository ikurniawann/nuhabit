"use client";

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useAccounts } from "../../accounts/queries";
import { useCreateContact, useUpdateContact } from "../queries";
import { CustomFieldsSection } from "@/features/crm/custom-fields";

import { EMPTY_CONTACT_FORM, contactToForm, type ContactFormValues, type SalesContact } from "../types";

const NO_ACCOUNT = "none";

interface ContactFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact: SalesContact | null;
  /** account default saat tambah dari halaman Account 360° */
  defaultAccountId?: string | null;
}

/** EPIC-050 T-1.3 — form Contact (PIC) dengan pilihan Account. */
export function ContactFormDialog({ open, onOpenChange, contact, defaultAccountId }: ContactFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {open ? (
          <ContactFormBody
            key={contact?.id ?? `new-${defaultAccountId ?? ""}`}
            onOpenChange={onOpenChange}
            contact={contact}
            defaultAccountId={defaultAccountId}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ContactFormBody({ onOpenChange, contact, defaultAccountId }: Omit<ContactFormDialogProps, "open">) {
  const [form, setForm] = useState<ContactFormValues>(() =>
    contact ? contactToForm(contact) : { ...EMPTY_CONTACT_FORM, account_id: defaultAccountId ?? "" }
  );
  const [accountSearch, setAccountSearch] = useState("");
  const isEdit = contact !== null;

  const accountsQuery = useAccounts({ q: accountSearch, account_type: "", city: "", page: 1 });
  const accountOptions = useMemo(() => accountsQuery.data?.data ?? [], [accountsQuery.data]);

  const close = () => onOpenChange(false);
  const createMutation = useCreateContact(close);
  const updateMutation = useUpdateContact(close);
  const isPending = createMutation.isPending || updateMutation.isPending;

  const set = <K extends keyof ContactFormValues>(key: K, value: ContactFormValues[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const canSubmit = form.name.trim().length > 0 && form.phone.trim().length >= 8;
  const handleSubmit = () => {
    if (!canSubmit || isPending) return;
    if (isEdit && contact) updateMutation.mutate({ id: contact.id, values: form });
    else createMutation.mutate(form);
  };

  return (
    <>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Contact" : "Tambah Contact"}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Account</Label>
            <Input
              value={accountSearch}
              onChange={(e) => setAccountSearch(e.target.value)}
              placeholder="Cari account…"
              className="mb-1"
            />
            <Select value={form.account_id || NO_ACCOUNT} onValueChange={(v) => set("account_id", v === NO_ACCOUNT ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Pilih account" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_ACCOUNT}>Tanpa account (perorangan)</SelectItem>
                {form.account_id && !accountOptions.some((a) => a.id === form.account_id) && contact?.account_name ? (
                  <SelectItem value={form.account_id}>{contact.account_name}</SelectItem>
                ) : null}
                {accountOptions.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}{a.city ? ` · ${a.city}` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ct_name">Nama *</Label>
            <Input id="ct_name" value={form.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ct_title">Jabatan</Label>
            <Input id="ct_title" value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="cth. HR Manager" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ct_phone">No. WhatsApp *</Label>
            <Input id="ct_phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="0812…" inputMode="tel" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ct_email">Email</Label>
            <Input id="ct_email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-gray-700 sm:col-span-2">
            <Checkbox checked={form.is_primary} onCheckedChange={(v) => set("is_primary", Boolean(v))} />
            Jadikan contact utama account ini
          </label>
          <CustomFieldsSection object="contact" values={form.custom ?? {}} onChange={(next) => set("custom", next)} />
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ct_notes">Catatan</Label>
            <Textarea id="ct_notes" rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={isPending}>Batal</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || isPending}>
            {isPending ? "Menyimpan…" : isEdit ? "Simpan Perubahan" : "Tambah Contact"}
          </Button>
        </DialogFooter>
    </>
  );
}
