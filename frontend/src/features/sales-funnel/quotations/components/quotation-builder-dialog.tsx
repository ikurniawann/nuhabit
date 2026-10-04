"use client";

import { useState } from "react";
import { Package, Plus, Trash2, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatRupiah } from "@/lib/format";
import { useCatalogProducts, useCreateQuotation, useUpdateQuotation } from "../queries";
import {
  DEFAULT_TERMS_PRESET,
  EMPTY_ITEM_FORM,
  EMPTY_QUOTATION_FORM,
  EMPTY_TERM_FORM,
  formTotals,
  itemLineTotal,
  termPercentSum,
  type Quotation,
  type QuotationFormValues,
  type QuotationItemForm,
  type QuotationTermForm,
} from "../types";

interface QuotationBuilderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealId: string;
  /** null = buat baru; terisi = edit draft */
  quotation: Quotation | null;
}

function quotationToForm(quotation: Quotation): QuotationFormValues {
  return {
    use_ppn: quotation.use_ppn,
    ppn_persen: String(Number(quotation.ppn_persen)),
    discount_percent: String(Number(quotation.discount_percent ?? 0)),
    notes: quotation.notes ?? "",
    valid_until: quotation.valid_until?.slice(0, 10) ?? "",
    items: quotation.items.map((item) => ({
      item_type: item.item_type,
      product_id: item.product_id ?? "",
      description: item.description,
      qty: String(Number(item.qty)),
      unit_price: String(Number(item.unit_price)),
    })),
    terms: (quotation.terms ?? []).map((term) => ({
      label: term.label,
      percent: String(Number(term.percent)),
      due_date: term.due_date?.slice(0, 10) ?? "",
    })),
  };
}

export function QuotationBuilderDialog({ open, onOpenChange, dealId, quotation }: QuotationBuilderDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <QuotationBuilderForm
          key={quotation?.id ?? "new"}
          dealId={dealId}
          quotation={quotation}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Isi builder; di-mount ulang per quotation (key) sehingga state awal dari props. */
function QuotationBuilderForm({
  dealId,
  quotation,
  onClose,
}: {
  dealId: string;
  quotation: Quotation | null;
  onClose: () => void;
}) {
  const [form, setForm] = useState<QuotationFormValues>(() =>
    quotation ? quotationToForm(quotation) : { ...EMPTY_QUOTATION_FORM, items: [{ ...EMPTY_ITEM_FORM }] }
  );
  const isEdit = quotation !== null;

  const productsQuery = useCatalogProducts();
  const products = productsQuery.data ?? [];

  const createMutation = useCreateQuotation(dealId, onClose);
  const updateMutation = useUpdateQuotation(onClose);
  const isPending = createMutation.isPending || updateMutation.isPending;

  const setItem = (index: number, patch: Partial<QuotationItemForm>) =>
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((item, i) =>
        i === index ? { ...item, ...patch } : item
      ),
    }));

  const addRow = (item_type: QuotationItemForm["item_type"]) =>
    setForm((prev) => ({
      ...prev,
      items: [...prev.items, { ...EMPTY_ITEM_FORM, item_type }],
    }));

  const removeRow = (index: number) =>
    setForm((prev) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index),
    }));

  const pickProduct = (index: number, productId: string) => {
    const product = products.find((p) => p.id === productId);
    setItem(index, {
      product_id: productId,
      description: product?.name ?? "",
      unit_price:
        product && Number(product.base_price) > 0
          ? String(Number(product.base_price))
          : form.items[index].unit_price,
    });
  };

  const setTerm = (index: number, patch: Partial<QuotationTermForm>) =>
    setForm((prev) => ({
      ...prev,
      terms: prev.terms.map((term, i) =>
        i === index ? { ...term, ...patch } : term
      ),
    }));
  const addTerm = () =>
    setForm((prev) => ({ ...prev, terms: [...prev.terms, { ...EMPTY_TERM_FORM }] }));
  const removeTerm = (index: number) =>
    setForm((prev) => ({
      ...prev,
      terms: prev.terms.filter((_, i) => i !== index),
    }));

  const totals = formTotals(form);
  const isCompleteRow = (item: QuotationItemForm) =>
    item.description.trim() !== "" &&
    Number(item.qty) > 0 &&
    (item.item_type !== "produk" || item.product_id !== "");
  const incompleteCount = form.items.filter((item) => !isCompleteRow(item)).length;
  const percentSum = termPercentSum(form.terms);
  const incompleteTermCount = form.terms.filter(
    (term) => term.label.trim() === "" || !(Number(term.percent) > 0)
  ).length;
  // Termin opsional; bila diisi: baris lengkap + Σ persen tepat 100
  // (validasi sama dgn server — jangan sampai 400 baru ketahuan)
  const termsValid =
    form.terms.length === 0 ||
    (incompleteTermCount === 0 && Math.abs(percentSum - 100) <= 0.01);
  // Semua baris wajib lengkap — baris setengah jadi JANGAN dibuang
  // diam-diam saat simpan (temuan gate F1: item hilang tanpa peringatan)
  const canSubmit = form.items.length > 0 && incompleteCount === 0 && termsValid;

  const handleSubmit = () => {
    if (!canSubmit || isPending) return;
    if (quotation) {
      updateMutation.mutate({ id: quotation.id, values: { form } });
    } else {
      createMutation.mutate(form);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {isEdit ? `Edit Quotation ${quotation?.quote_number}` : "Buat Quotation"}
        </DialogTitle>
      </DialogHeader>

      {/* ── Baris item ── */}
      <div className="space-y-2.5">
        {form.items.map((item, index) => (
          <div
            key={index}
            className="rounded-xl border border-gray-200/80 bg-gray-50/50 p-3"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                {item.item_type === "produk" ? (
                  <>
                    <Package className="h-3.5 w-3.5 text-pink-500" /> Produk
                    Katalog
                  </>
                ) : (
                  <>
                    <Type className="h-3.5 w-3.5 text-gray-400" /> Item Bebas
                  </>
                )}
              </span>
              <button
                type="button"
                onClick={() => removeRow(index)}
                disabled={form.items.length === 1}
                className="text-gray-300 hover:text-red-500 disabled:opacity-30"
                aria-label="Hapus baris"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
              {item.item_type === "produk" ? (
                <div className="sm:col-span-5">
                  <Select
                    value={item.product_id || undefined}
                    onValueChange={(v) => pickProduct(index, v)}
                  >
                    <SelectTrigger className="h-9 bg-white">
                      <SelectValue placeholder="Pilih produk..." />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map((product) => (
                        <SelectItem key={product.id} value={product.id}>
                          {product.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="sm:col-span-5">
                  <Input
                    value={item.description}
                    onChange={(e) => setItem(index, { description: e.target.value })}
                    placeholder="Deskripsi (mis. Sewa venue 4 jam)"
                    className="h-9 bg-white text-sm"
                  />
                </div>
              )}
              <div className="sm:col-span-2">
                <Input
                  type="number"
                  min={0}
                  value={item.qty}
                  onChange={(e) => setItem(index, { qty: e.target.value })}
                  placeholder={item.item_type === "produk" ? "Pax" : "Qty"}
                  title={item.item_type === "produk" ? "Jumlah pax" : "Qty"}
                  className="h-9 bg-white text-sm"
                />
              </div>
              <div className="sm:col-span-3">
                <Input
                  type="number"
                  min={0}
                  value={item.unit_price}
                  onChange={(e) => setItem(index, { unit_price: e.target.value })}
                  placeholder={
                    item.item_type === "produk" ? "Harga per pax" : "Harga satuan"
                  }
                  className="h-9 bg-white text-sm"
                />
              </div>
              <div className="flex items-center justify-end text-sm font-semibold text-gray-900 sm:col-span-2">
                {formatRupiah(itemLineTotal(item))}
              </div>
            </div>
          </div>
        ))}

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => addRow("produk")}
            className="h-9 gap-1.5 rounded-lg border-pink-200 text-pink-700 hover:bg-pink-50"
          >
            <Plus className="h-3.5 w-3.5" /> Add Produk
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => addRow("bebas")}
            className="h-9 gap-1.5 rounded-lg border-gray-200"
          >
            <Plus className="h-3.5 w-3.5" /> Item Bebas
          </Button>
        </div>
      </div>

      {/* ── PPN + total ── */}
      <div className="rounded-xl border border-gray-200/80 p-3.5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <Checkbox
              checked={form.use_ppn}
              onCheckedChange={(checked) =>
                setForm((prev) => ({ ...prev, use_ppn: checked === true }))
              }
            />
            Pakai PPN
            <Input
              type="number"
              min={0}
              max={100}
              value={form.ppn_persen}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, ppn_persen: e.target.value }))
              }
              disabled={!form.use_ppn}
              className="h-8 w-16 text-sm"
            />
            <span className="text-gray-500">%</span>
            <span className="ml-3 text-gray-700">Diskon</span>
            <Input
              type="number"
              min={0}
              max={100}
              step="0.5"
              value={form.discount_percent}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, discount_percent: e.target.value }))
              }
              className="h-8 w-16 text-sm"
              title="Diskon > 10% butuh persetujuan admin, > 20% owner (bisa diubah di Pengaturan CRM → Approval Rules)"
            />
            <span className="text-gray-500">%</span>
          </label>
          <div className="space-y-0.5 text-right text-sm">
            <p className="text-gray-500">
              Subtotal:{" "}
              <span className="font-medium text-gray-900">
                {formatRupiah(totals.subtotal)}
              </span>
            </p>
            {totals.discount > 0 ? (
              <p className="text-gray-500">
                Diskon {Number(form.discount_percent) || 0}%:{" "}
                <span className="font-medium text-red-600">- {formatRupiah(totals.discount)}</span>
              </p>
            ) : null}
            {form.use_ppn ? (
              <p className="text-gray-500">
                PPN {form.ppn_persen}%:{" "}
                <span className="font-medium text-gray-900">
                  {formatRupiah(totals.ppn)}
                </span>
              </p>
            ) : null}
            <p className="text-base font-bold text-gray-900">
              Total: {formatRupiah(totals.total)}
            </p>
          </div>
        </div>
      </div>

      {/* ── Termin pembayaran (Fase G) ── */}
      <div className="rounded-xl border border-gray-200/80 p-3.5">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900">
              Termin Pembayaran
            </p>
            <p className="text-xs text-gray-500">
              Opsional — jadwal cicilan (Σ persen wajib 100%); tampil di PDF
              & jadi acuan progress pelunasan deal.
            </p>
          </div>
          {form.terms.length === 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setForm((prev) => ({
                  ...prev,
                  terms: DEFAULT_TERMS_PRESET.map((t) => ({ ...t })),
                }))
              }
              className="h-8 gap-1.5 rounded-lg"
            >
              <Plus className="h-3.5 w-3.5" /> Pakai Termin
            </Button>
          ) : null}
        </div>
        {form.terms.length > 0 ? (
          <div className="space-y-2">
            {form.terms.map((term, index) => (
              <div
                key={index}
                className="grid grid-cols-1 items-center gap-2 sm:grid-cols-12"
              >
                <div className="sm:col-span-4">
                  <Input
                    value={term.label}
                    onChange={(e) => setTerm(index, { label: e.target.value })}
                    placeholder={`mis. ${index === 0 ? "DP" : "Pelunasan"}`}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="flex items-center gap-1 sm:col-span-2">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={term.percent}
                    onChange={(e) => setTerm(index, { percent: e.target.value })}
                    placeholder="%"
                    className="h-9 text-sm"
                  />
                  <span className="text-xs text-gray-500">%</span>
                </div>
                <div className="sm:col-span-3">
                  <Input
                    type="date"
                    value={term.due_date}
                    onChange={(e) => setTerm(index, { due_date: e.target.value })}
                    title="Jatuh tempo (opsional)"
                    className="h-9 text-sm"
                  />
                </div>
                <div className="flex items-center justify-end gap-2 sm:col-span-3">
                  <span className="text-sm font-medium text-gray-700">
                    {formatRupiah(
                      Math.round(totals.total * (Number(term.percent) || 0)) / 100
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeTerm(index)}
                    className="text-gray-300 hover:text-red-500"
                    aria-label="Hapus termin"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addTerm}
                disabled={form.terms.length >= 12}
                className="h-8 gap-1.5 rounded-lg"
              >
                <Plus className="h-3.5 w-3.5" /> Tambah Termin
              </Button>
              <span
                className={`text-xs font-medium ${
                  Math.abs(percentSum - 100) <= 0.01
                    ? "text-emerald-600"
                    : "text-amber-600"
                }`}
              >
                Total: {percentSum}% {Math.abs(percentSum - 100) <= 0.01 ? "✓" : "— harus 100%"}
              </span>
            </div>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="q_valid">Berlaku Sampai</Label>
          <Input
            id="q_valid"
            type="date"
            value={form.valid_until}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, valid_until: e.target.value }))
            }
            className="h-9"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="q_notes">Catatan</Label>
          <Textarea
            id="q_notes"
            value={form.notes}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, notes: e.target.value }))
            }
            rows={1}
            placeholder="Syarat pembayaran, DP, dsb."
            className="text-sm"
          />
        </div>
      </div>

      <DialogFooter className="items-center">
        {incompleteCount > 0 ? (
          <p className="mr-auto text-xs text-amber-600">
            {incompleteCount} baris belum lengkap — isi atau hapus dulu.
          </p>
        ) : !termsValid ? (
          <p className="mr-auto text-xs text-amber-600">
            Termin belum sah — lengkapi label/persen dan pastikan total 100%.
          </p>
        ) : null}
        <Button variant="outline" onClick={onClose} disabled={isPending}>
          Batal
        </Button>
        <Button onClick={handleSubmit} disabled={!canSubmit || isPending}>
          {isPending
            ? "Menyimpan…"
            : isEdit
              ? "Simpan Perubahan"
              : "Simpan Quotation"}
        </Button>
      </DialogFooter>
    </>
  );
}
