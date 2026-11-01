"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { DsDateTimePicker } from "@/components/design-system";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumericInput } from "@/components/ui/numeric-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ApInvoiceRow } from "@/lib/accounting/ap-types";
import { formatDate, formatRupiah } from "@/lib/format";
import {
  defaultPaymentForm,
  paymentKind,
  todayIsoDate,
  validatePaymentForm,
  type PaymentFormValues,
} from "@/lib/purchasing/po-ui-detail";
import type { VendorPayment } from "@/types/purchasing";
import { usePayPurchaseOrderInvoice } from "../../mutations";

const METHOD_OPTIONS = [
  { value: "bank_transfer", label: "Transfer Bank" },
  { value: "cash", label: "Tunai" },
  { value: "giro", label: "Giro" },
  { value: "qris", label: "QRIS" },
  { value: "other", label: "Lainnya" },
];

interface POPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Invoice AP PO yang masih punya sisa tagihan, terlama dulu. */
  invoices: ApInvoiceRow[];
}

/** Catat pembayaran vendor lewat Accounts Payable; termin PO dipilih otomatis oleh server. */
export function POPaymentDialog({ open, onOpenChange, invoices }: POPaymentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden rounded-2xl border border-gray-200/70 p-0 shadow-xl ring-1 ring-gray-200/60 sm:max-w-[620px]">
        <DialogHeader className="border-b border-gray-200/70 px-5 py-4">
          <DialogTitle className="text-base font-semibold text-gray-900">Bayar Purchase Order</DialogTitle>
          <DialogDescription className="mt-1 text-sm leading-5 text-gray-500">
            Pembayaran dicatat ke invoice AP dari GRN purchase order ini. Pelunasan penuh diberi label{" "}
            <span className="font-medium text-gray-700">Lunas</span>; nominal lebih kecil dicatat sebagai cicilan.
          </DialogDescription>
        </DialogHeader>
        <PaymentForm invoices={invoices} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

const invoiceLabel = (invoice: ApInvoiceRow) =>
  `${invoice.invoice_no}${invoice.grn_number ? ` · ${invoice.grn_number}` : ""} · sisa ${formatRupiah(
    invoice.outstanding_amount
  )}`;

function PaymentForm({ invoices, onClose }: { invoices: ApInvoiceRow[]; onClose: () => void }) {
  const [form, setForm] = useState<PaymentFormValues>(() => defaultPaymentForm(invoices, todayIsoDate()));
  const pay = usePayPurchaseOrderInvoice();
  const invoice = invoices.find((row) => row.id === form.invoice_id);
  const outstanding = Number(invoice?.outstanding_amount ?? 0);
  const kind = paymentKind(form.amount, outstanding);
  const patch = (values: Partial<PaymentFormValues>) => setForm((prev) => ({ ...prev, ...values }));

  const selectInvoice = (id: string) => {
    const next = invoices.find((row) => row.id === id);
    patch({ invoice_id: id, amount: next?.outstanding_amount || undefined });
  };

  const handleSubmit = async () => {
    const invalid = invoice ? validatePaymentForm(form, outstanding) : "Pilih invoice AP yang akan dibayar";
    if (invalid) {
      toast.error(invalid);
      return;
    }
    try {
      await pay.mutateAsync({
        invoice_id: form.invoice_id,
        payment_date: form.payment_date,
        amount: Number(form.amount),
        method: form.method,
        reference_number: form.reference_number.trim() || null,
        notes: form.notes.trim() || null,
      });
      toast.success(kind === "full" ? "Pelunasan berhasil dicatat" : "Pembayaran berhasil dicatat");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal mencatat pembayaran");
    }
  };

  return (
    <>
      <div className="grid gap-4 px-5 py-4">
        <div className="space-y-1.5">
          <Label htmlFor="po-payment-invoice" className="text-xs">Invoice AP</Label>
          <Combobox
            id="po-payment-invoice"
            options={invoices.map((row) => ({ value: row.id, label: invoiceLabel(row) }))}
            value={form.invoice_id}
            onChange={selectInvoice}
            placeholder="Pilih invoice..."
            searchPlaceholder="Cari invoice..."
            emptyMessage="Invoice tidak ditemukan"
            className="h-9 text-sm"
          />
        </div>

        {invoice && (
          <div className="rounded-xl border border-pink-100 bg-pink-50 p-3">
            <div className="text-xs font-semibold text-pink-700">Sisa tagihan invoice</div>
            <div className="mt-1 text-lg font-bold text-pink-700">{formatRupiah(outstanding)}</div>
            <div className="mt-1 text-xs text-pink-700/80">
              Total {formatRupiah(invoice.total_amount)} · Dibayar {formatRupiah(invoice.allocated_amount)}
              {invoice.due_date && <> · Jatuh tempo {formatDate(invoice.due_date)}</>}
            </div>
          </div>
        )}

        {kind && (
          <div
            className={`rounded-xl border px-3 py-2 text-sm ${
              kind === "full"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-amber-200 bg-amber-50 text-amber-800"
            }`}
          >
            {kind === "full"
              ? "Pembayaran ini akan dicatat sebagai Lunas."
              : "Pembayaran ini akan dicatat sebagai cicilan."}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <DsDateTimePicker
            label="Tanggal Pembayaran"
            value={form.payment_date}
            onChange={(value) => patch({ payment_date: value })}
            placeholder="Pilih tanggal pembayaran..."
            dateOnly
            required
          />
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="po-payment-amount" className="text-xs">Nominal Pembayaran</Label>
              {outstanding > 0 && (
                <button
                  type="button"
                  className="text-xs font-medium text-pink-600 hover:underline"
                  onClick={() => patch({ amount: outstanding })}
                >
                  Bayar lunas
                </button>
              )}
            </div>
            <NumericInput id="po-payment-amount"
              value={form.amount}
              max={outstanding}
              onValueChange={(value) => patch({ amount: value || undefined })}
              decimalScale={0}
              className="h-9 text-sm"
            />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="po-payment-method" className="text-xs">Metode</Label>
            <Combobox id="po-payment-method"
              options={METHOD_OPTIONS}
              value={form.method}
              onChange={(value) => patch({ method: value as VendorPayment["method"] })}
              placeholder="Pilih metode..."
              searchPlaceholder="Cari metode..."
              emptyMessage="Metode tidak ditemukan"
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="po-payment-reference" className="text-xs">Nomor Referensi</Label>
            <Input id="po-payment-reference"
              value={form.reference_number}
              onChange={(event) => patch({ reference_number: event.target.value })}
              placeholder="Nomor transfer / bukti pembayaran"
              className="h-9 text-sm"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="po-payment-notes" className="text-xs">Catatan</Label>
          <Input id="po-payment-notes"
            value={form.notes}
            onChange={(event) => patch({ notes: event.target.value })}
            placeholder="Opsional"
            className="h-9 text-sm"
          />
        </div>
      </div>
      <DialogFooter className="mx-0 mb-0 gap-2 border-t border-gray-200/70 bg-gray-50/60 px-5 py-4 sm:justify-end">
        <Button variant="outline" onClick={onClose} className="purchasing-secondary-button">
          Batal
        </Button>
        <Button onClick={handleSubmit} disabled={pay.isPending || !invoice} className="purchasing-main-button">
          {pay.isPending ? "Memproses..." : "Simpan Pembayaran"}
        </Button>
      </DialogFooter>
    </>
  );
}
