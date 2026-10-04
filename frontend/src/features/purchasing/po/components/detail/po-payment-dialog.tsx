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
import { formatRupiah } from "@/lib/format";
import {
  defaultPaymentForm,
  paymentKind,
  todayIsoDate,
  validatePaymentForm,
  type PaymentFormValues,
  type PODetailFigures,
} from "@/lib/purchasing/po-ui-detail";
import type { PurchaseOrderPaymentTerm, VendorPayment } from "@/types/purchasing";
import { useCreateVendorPayment } from "../../mutations";

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
  poId: string;
  paidAmount: number;
  terms: PurchaseOrderPaymentTerm[];
  figures: PODetailFigures;
}

/** Catat pembayaran vendor; nilai awal = termin pertama yang belum lunas dan sisa tagihan PO. */
export function POPaymentDialog({ open, onOpenChange, ...formProps }: POPaymentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden rounded-2xl border border-gray-200/70 p-0 shadow-xl ring-1 ring-gray-200/60 sm:max-w-[620px]">
        <DialogHeader className="border-b border-gray-200/70 px-5 py-4">
          <DialogTitle className="text-base font-semibold text-gray-900">Bayar Purchase Order</DialogTitle>
          <DialogDescription className="mt-1 text-sm leading-5 text-gray-500">
            Catat pembayaran untuk purchase order ini. Pelunasan penuh diberi label{" "}
            <span className="font-medium text-gray-700">Lunas</span>; nominal lebih kecil dicatat sebagai cicilan.
          </DialogDescription>
        </DialogHeader>
        <PaymentForm {...formProps} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function PaymentForm({
  poId,
  paidAmount,
  terms,
  figures,
  onClose,
}: Omit<POPaymentDialogProps, "open" | "onOpenChange"> & { onClose: () => void }) {
  const outstanding = figures.outstandingAmount;
  const [form, setForm] = useState<PaymentFormValues>(() => defaultPaymentForm(terms, outstanding, todayIsoDate()));
  const createPayment = useCreateVendorPayment();
  const kind = paymentKind(form.amount, outstanding);
  const patch = (values: Partial<PaymentFormValues>) => setForm((prev) => ({ ...prev, ...values }));

  const handleSubmit = async () => {
    const invalid = validatePaymentForm(form, outstanding);
    if (invalid) {
      toast.error(invalid);
      return;
    }
    try {
      await createPayment.mutateAsync({
        poId,
        payload: {
          payment_term_id: form.payment_term_id || null,
          payment_date: form.payment_date,
          amount: Number(form.amount),
          method: form.method,
          reference_number: form.reference_number.trim() || null,
          notes: form.notes.trim() || null,
        },
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
        <div className="rounded-xl border border-pink-100 bg-pink-50 p-3">
          <div className="text-xs font-semibold text-pink-700">Sisa tagihan</div>
          <div className="mt-1 text-lg font-bold text-pink-700">{formatRupiah(outstanding)}</div>
          <div className="mt-1 text-xs text-pink-700/80">
            Total PO {formatRupiah(figures.grossPayableAmount)}
            {figures.returnCreditAmount > 0 && <> · Retur -{formatRupiah(figures.returnCreditAmount)}</>}
            {figures.rejectCreditAmount > 0 && <> · Nota kredit reject -{formatRupiah(figures.rejectCreditAmount)}</>}
            {" · "}Tagihan bersih {formatRupiah(figures.payableAmount)} · Dibayar {formatRupiah(paidAmount)}
          </div>
        </div>

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
              <Label className="text-xs">Nominal Pembayaran</Label>
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
            <NumericInput
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
            <Label className="text-xs">Metode</Label>
            <Combobox
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
            <Label className="text-xs">Nomor Referensi</Label>
            <Input
              value={form.reference_number}
              onChange={(event) => patch({ reference_number: event.target.value })}
              placeholder="Nomor transfer / bukti pembayaran"
              className="h-9 text-sm"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Catatan</Label>
          <Input
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
        <Button
          onClick={handleSubmit}
          disabled={createPayment.isPending || outstanding <= 0}
          className="purchasing-main-button"
        >
          {createPayment.isPending ? "Memproses..." : "Simpan Pembayaran"}
        </Button>
      </DialogFooter>
    </>
  );
}
