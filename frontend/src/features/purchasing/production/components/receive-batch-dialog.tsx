"use client";

import { useState } from "react";
import { Loader2, PackageCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatNumber, formatRupiah } from "@/lib/format";
import {
  buildReceiptPayload,
  canSubmitReceipt,
  initReceiptForm,
  previewReceipt,
  variantRemainder,
  type ProductionFlow,
  type ReceiptForm,
} from "@/lib/purchasing/production-flow";

const INPUT_CLASS = "h-9 text-sm focus:border-pink-400 focus:ring-2 focus:ring-pink-100";

const CONVERSION_FIELDS = [
  { field: "overhead", label: "Overhead" },
  { field: "labor", label: "Tenaga Kerja" },
  { field: "packaging", label: "Kemasan" },
  { field: "waste", label: "Susut" },
] as const;

type ReceiveBatchDialogProps = {
  flow: ProductionFlow;
  open: boolean;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (payload: ReturnType<typeof buildReceiptPayload>) => void;
};

/** Form "Terima Hasil" satu batch: state di-reset setiap dibuka. */
export function ReceiveBatchDialog({ open, submitting, onClose, ...props }: ReceiveBatchDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !submitting && onClose()}>
      {open && <ReceiveBatchPanel submitting={submitting} onClose={onClose} {...props} />}
    </Dialog>
  );
}

function ReceiveBatchPanel({ flow, submitting, onClose, onSubmit }: Omit<ReceiveBatchDialogProps, "open">) {
  const [form, setForm] = useState<ReceiptForm>(() => initReceiptForm(flow));
  const variantRequired = flow.variant_skus.length > 0;
  const preview = previewReceipt(flow, form);
  const remainder = variantRemainder(form);
  const set = <K extends keyof ReceiptForm>(field: K, value: ReceiptForm[K]) =>
    setForm((current) => ({ ...current, [field]: value }));

  return (
    <DialogPanel size="lg" className="max-h-[min(92vh,960px)]">
      <DialogPanelHeader>
        <DialogPanelTitle>Terima Hasil Produksi</DialogPanelTitle>
        <DialogPanelDescription>
          Catat hasil baik dan scrap untuk satu batch {flow.order.nomor_produksi}. Batch terakhir menutup order dan
          mengambil seluruh sisa WIP.
        </DialogPanelDescription>
      </DialogPanelHeader>
      <DialogPanelBody className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="receipt-good" className="text-xs text-gray-500">
              Hasil baik
            </Label>
            <Input
              id="receipt-good"
              value={form.qtyGood}
              onChange={(event) => set("qtyGood", event.target.value)}
              type="number"
              min="0"
              step="any"
              className={INPUT_CLASS}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="receipt-scrap" className="text-xs text-gray-500">
              Scrap / reject
            </Label>
            <Input
              id="receipt-scrap"
              value={form.qtyScrap}
              onChange={(event) => set("qtyScrap", event.target.value)}
              type="number"
              min="0"
              step="any"
              className={INPUT_CLASS}
            />
          </div>
        </div>

        <div className="flex items-start justify-between gap-4 rounded-lg border border-gray-200/70 px-4 py-3">
          <div>
            <p id="receipt-final-label" className="text-sm font-medium text-gray-900">
              Batch terakhir
            </p>
            <p className="text-xs text-gray-500">
              Order selesai setelah batch ini. Matikan jika masih ada hasil yang menyusul.
            </p>
          </div>
          <Switch
            aria-labelledby="receipt-final-label"
            checked={form.final}
            onCheckedChange={(checked) => set("final", checked)}
          />
        </div>

        {form.final && (
          <div className="grid gap-4 sm:grid-cols-4">
            {CONVERSION_FIELDS.map(({ field, label }) => (
              <div key={field} className="space-y-1.5">
                <Label htmlFor={`receipt-${field}`} className="text-xs text-gray-500">
                  {label}
                </Label>
                <Input
                  id={`receipt-${field}`}
                  value={form[field]}
                  onChange={(event) => set(field, event.target.value)}
                  type="number"
                  min="0"
                  className={INPUT_CLASS}
                />
              </div>
            ))}
          </div>
        )}

        {variantRequired && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-900">Rincian per varian</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {flow.variant_skus.map((sku) => (
                <div key={sku.id} className="space-y-1.5">
                  <Label htmlFor={`receipt-sku-${sku.id}`} className="text-xs text-gray-500">
                    {sku.sku} · {sku.name}
                  </Label>
                  <Input
                    id={`receipt-sku-${sku.id}`}
                    value={form.variants[sku.id] ?? ""}
                    onChange={(event) => set("variants", { ...form.variants, [sku.id]: event.target.value })}
                    type="number"
                    min="0"
                    step="any"
                    className={INPUT_CLASS}
                  />
                </div>
              ))}
            </div>
            <p
              className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                Math.abs(remainder) <= 0.01 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
              }`}
            >
              Sisa belum dibagi: {formatNumber(remainder, 2)}
            </p>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="receipt-note" className="text-xs text-gray-500">
            Catatan
          </Label>
          <Textarea id="receipt-note" value={form.catatan} onChange={(event) => set("catatan", event.target.value)} rows={2} />
        </div>

        <dl className="grid gap-2 rounded-lg bg-gray-50 px-4 py-3 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-3">
            <dt className="text-gray-500">Biaya bahan</dt>
            <dd className="font-medium">{formatRupiah(preview.material)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-gray-500">Biaya konversi</dt>
            <dd className="font-medium">{formatRupiah(preview.conversion)}</dd>
          </div>
          {preview.scrap > 0 && (
            <div className="flex justify-between gap-3 sm:col-span-2">
              <dt className="text-red-600">WIP dibebankan sebagai scrap</dt>
              <dd className="font-semibold text-red-700">{formatRupiah(preview.scrap)}</dd>
            </div>
          )}
          <div className="flex justify-between gap-3 sm:col-span-2">
            <dt className="font-medium text-gray-900">Perkiraan HPP / unit</dt>
            <dd className="font-semibold text-emerald-700">{formatRupiah(preview.hpp)}</dd>
          </div>
        </dl>
      </DialogPanelBody>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={submitting}
          className="purchasing-secondary-button w-full gap-2 sm:w-auto"
        >
          Batal
        </Button>
        <Button
          type="button"
          onClick={() => onSubmit(buildReceiptPayload(form, variantRequired))}
          disabled={submitting || !canSubmitReceipt(form, variantRequired)}
          className="purchasing-main-button w-full gap-2 sm:w-auto"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
          Terima Hasil
        </Button>
      </DialogFooter>
    </DialogPanel>
  );
}
