"use client";

import { useState, type FormEvent } from "react";
import { FormModal } from "@/components/ui/form-modal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSaveWholesaleAccount, type WholesaleAccount, type WholesaleAccountForm, type WholesaleAccountResult } from "../queries";

const EMPTY: WholesaleAccountForm = {
  company_name: "",
  contact_name: "",
  email: "",
  phone: "",
  discount_pct: 0,
  min_order_idr: 0,
  payment_terms: "invoice",
  status: "active",
};

const fromAccount = (account: WholesaleAccount): WholesaleAccountForm => ({
  company_name: account.company_name,
  contact_name: account.contact_name,
  email: account.email,
  phone: account.phone ?? "",
  discount_pct: account.discount_pct,
  min_order_idr: account.min_order_idr,
  payment_terms: account.payment_terms,
  status: account.status,
});

/**
 * Buat atau ubah akun mitra. Saat membuat, atau saat "reset kata sandi"
 * dicentang, respons membawa kata sandi sekali pakai; `onSaved`
 * menerimanya untuk ditampilkan sekali.
 */
export function AccountFormModal({
  account,
  onClose,
  onSaved,
}: {
  account: WholesaleAccount | null;
  onClose: () => void;
  onSaved: (result: WholesaleAccountResult) => void;
}) {
  const [form, setForm] = useState<WholesaleAccountForm>(account ? fromAccount(account) : EMPTY);
  const [resetPassword, setResetPassword] = useState(false);
  const save = useSaveWholesaleAccount();
  const set = <K extends keyof WholesaleAccountForm>(key: K, value: WholesaleAccountForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate({ id: account?.id ?? null, form, resetPassword }, { onSuccess: onSaved });
  };

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      title={account ? "Ubah akun mitra" : "Akun mitra baru"}
      description="Harga mitra = harga retail dikurangi diskon, kecuali produk punya harga wholesale khusus."
      onSubmit={submit}
      submitLabel={account ? "Simpan" : "Buat akun"}
      cancelLabel="Batal"
      loadingLabel="Menyimpan..."
      loading={save.isPending}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="ws-company">Nama perusahaan</Label>
          <Input id="ws-company" required value={form.company_name} onChange={(e) => set("company_name", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ws-contact">Nama kontak</Label>
          <Input id="ws-contact" required value={form.contact_name} onChange={(e) => set("contact_name", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ws-phone">Telepon / WA</Label>
          <Input id="ws-phone" inputMode="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="ws-email">Email (untuk masuk)</Label>
          <Input id="ws-email" type="email" required value={form.email} onChange={(e) => set("email", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ws-discount">Diskon (%)</Label>
          <Input
            id="ws-discount"
            type="number"
            min={0}
            max={100}
            step="0.5"
            value={form.discount_pct}
            onChange={(e) => set("discount_pct", Number(e.target.value) || 0)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ws-min-order">Minimal pesanan (Rp)</Label>
          <Input
            id="ws-min-order"
            type="number"
            min={0}
            step={1000}
            value={form.min_order_idr}
            onChange={(e) => set("min_order_idr", Number(e.target.value) || 0)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Termin pembayaran</Label>
          <Select value={form.payment_terms} onValueChange={(value) => set("payment_terms", value as WholesaleAccountForm["payment_terms"])}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="invoice">Invoice Xendit</SelectItem>
              <SelectItem value="pay_later">Bayar nanti (30 hari)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Status</Label>
          <Select value={form.status} onValueChange={(value) => set("status", value as WholesaleAccountForm["status"])}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Aktif</SelectItem>
              <SelectItem value="disabled">Nonaktif</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {account ? (
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={resetPassword} onChange={(e) => setResetPassword(e.target.checked)} />
            Reset kata sandi (kata sandi baru tampil sekali setelah disimpan; sesi mitra berakhir)
          </label>
        ) : null}
      </div>
    </FormModal>
  );
}
