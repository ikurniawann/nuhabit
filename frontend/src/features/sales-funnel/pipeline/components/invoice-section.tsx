"use client";

import { formatDate, formatNumber, formatRupiah } from "@/lib/format";
import { useState } from "react";
import { FileCheck2, FileDown, Loader2, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogPanel,
  DialogPanelBody,
  DialogPanelHeader,
  DialogPanelTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RupiahInput } from "./rupiah-input";
import {
  useCreateDealInvoice,
  useDealInvoices,
  useDeleteDealInvoice,
} from "../queries";
import type { InvoiceTermOption } from "../api";

/**
 * Pengajuan invoice per deal (EPIC-025 Opsi B): sales MENGAJUKAN invoice
 * dari kesepakatan termin quotation acuan lewat popup; penerbitan, batal,
 * dan pencatatan pembayaran diproses modul Finance. PPN mengikuti setelan
 * quotation — nominal termin sudah termasuk PPN, breakdown DPP/PPN
 * ditampilkan informatif.
 */

const STATUS_BADGES: Record<string, string> = {
  diajukan: "bg-amber-100 text-amber-700",
  draft: "bg-gray-100 text-gray-600",
  terkirim: "bg-blue-100 text-blue-700",
  batal: "bg-red-100 text-red-600",
};

const PAYMENT_BADGES: Record<string, string> = {
  lunas: "bg-emerald-100 text-emerald-700",
  sebagian: "bg-amber-100 text-amber-700",
  belum: "bg-gray-100 text-gray-500",
};

const CUSTOM_TERM = "custom";

export function InvoiceSection({
  dealId,
  enabled,
}: {
  dealId: string;
  enabled: boolean;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [termId, setTermId] = useState(CUSTOM_TERM);
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");

  const invoicesQuery = useDealInvoices(dealId, enabled);
  const createMutation = useCreateDealInvoice(dealId, () => {
    setFormOpen(false);
    setTermId(CUSTOM_TERM);
    setLabel("");
    setAmount("");
    setDueDate("");
  });
  const deleteMutation = useDeleteDealInvoice(dealId);

  const data = invoicesQuery.data;
  const invoices = data?.invoices ?? [];
  const reference = data?.reference ?? null;
  const availableTerms = data?.available_terms ?? [];
  const openTerms = availableTerms.filter((term) => !term.invoiced);

  const applyTerm = (value: string) => {
    setTermId(value);
    if (value === CUSTOM_TERM) return;
    const term = availableTerms.find((t) => t.term_id === value);
    if (term) {
      setLabel(term.label);
      setAmount(String(Math.round(term.amount)));
      setDueDate(term.due_date ?? "");
    }
  };

  const handleSubmit = () => {
    const value = Number(amount) || 0;
    if (!label.trim() || value <= 0 || createMutation.isPending) return;
    createMutation.mutate({
      term_id: termId === CUSTOM_TERM ? null : termId,
      label: label.trim(),
      amount: value,
      due_date: dueDate || null,
    });
  };

  const termLabel = (term: InvoiceTermOption) =>
    `${term.label} (${formatNumber(term.percent, 3)}% · ${formatRupiah(term.amount)})`;

  // Breakdown PPN informatif — nominal termin sudah termasuk PPN
  const amountNumber = Number(amount) || 0;
  const withPpn = Boolean(reference?.use_ppn && (reference?.ppn_persen ?? 0) > 0);
  const dpp = withPpn
    ? Math.round(amountNumber / (1 + (reference?.ppn_persen ?? 0) / 100))
    : amountNumber;

  return (
    <div className="space-y-2.5 border-b border-gray-100 px-6 py-4">
      <div className="flex items-center justify-between">
        <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-900">
          <FileCheck2 className="h-4 w-4 text-pink-500" /> Invoice
        </p>
        <Button
          type="button"
          size="sm"
          onClick={() => setFormOpen(true)}
          className="h-8 gap-1 rounded-lg bg-pink-600 text-white hover:bg-pink-700"
        >
          <Plus className="h-3.5 w-3.5" /> Ajukan Invoice
        </Button>
      </div>

      <p className="text-xs text-gray-400">
        Pengajuan diproses modul Finance — penerbitan & pencatatan pembayaran
        di sana.
      </p>

      {reference ? (
        <p className="text-xs text-gray-400">
          Acuan termin: {reference.quote_number}
          {reference.is_accepted ? " · diterima" : ""} ·{" "}
          {formatRupiah(reference.total)}
          {reference.use_ppn
            ? ` · termasuk PPN ${reference.ppn_persen}%`
            : " · tanpa PPN"}
        </p>
      ) : null}

      {/* ── Daftar invoice ── */}
      {invoicesQuery.isLoading ? (
        <div className="py-3 text-center">
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-pink-600" />
        </div>
      ) : invoices.length === 0 ? (
        <p className="py-2 text-xs text-gray-400">
          Belum ada invoice — ajukan dari termin quotation yang disepakati.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {invoices.map((invoice) => (
            <li
              key={invoice.id}
              className="flex items-center justify-between gap-2 rounded-xl border border-gray-200/80 bg-white px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900">
                  {invoice.invoice_number}
                  <span className="ml-1.5 font-normal text-gray-500">
                    {invoice.label}
                  </span>
                </p>
                <p className="text-xs text-gray-500">
                  {invoice.due_date
                    ? `Jatuh tempo ${formatDate(invoice.due_date, "")}`
                    : "Tanpa jatuh tempo"}
                  {invoice.quote_number ? ` · ${invoice.quote_number}` : ""}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <div className="flex items-center justify-end gap-1">
                  <Badge className={`border-0 font-normal ${STATUS_BADGES[invoice.status]}`}>
                    {invoice.status}
                  </Badge>
                  {invoice.status !== "batal" ? (
                    <Badge
                      className={`border-0 font-normal ${PAYMENT_BADGES[invoice.payment_status]}`}
                    >
                      {invoice.payment_status}
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-0.5 text-sm font-semibold text-gray-900">
                  {invoice.paid > 0 ? `${formatRupiah(invoice.paid)} / ` : ""}
                  {formatRupiah(invoice.amount)}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-center gap-1.5">
                {invoice.status === "terkirim" ? (
                  <a
                    href={`/api/sales-funnel/invoices/${invoice.id}/pdf`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Unduh PDF"
                    className="text-gray-400 hover:text-pink-600"
                  >
                    <FileDown className="h-4 w-4" />
                  </a>
                ) : null}
                {invoice.status === "diajukan" ? (
                  <button
                    type="button"
                    onClick={() => deleteMutation.mutate(invoice.id)}
                    title="Tarik pengajuan (belum diproses Finance)"
                    className="text-gray-300 hover:text-red-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* ── Popup buat invoice ── */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogPanel size="sm">
          <DialogPanelHeader>
            <DialogPanelTitle>Ajukan Invoice</DialogPanelTitle>
            {reference ? (
              <p className="text-xs text-gray-500">
                Acuan {reference.quote_number} · {formatRupiah(reference.total)}
                {reference.use_ppn
                  ? ` (termasuk PPN ${reference.ppn_persen}%)`
                  : " (tanpa PPN)"}
              </p>
            ) : null}
          </DialogPanelHeader>
          <DialogPanelBody className="space-y-3">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-gray-600">Termin</p>
              <Select value={termId} onValueChange={applyTerm}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue placeholder="Pilih termin..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={CUSTOM_TERM}>
                    Nominal bebas (tanpa termin)
                  </SelectItem>
                  {openTerms.map((term) => (
                    <SelectItem key={term.term_id} value={term.term_id}>
                      {termLabel(term)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {availableTerms.length > 0 && openTerms.length === 0 ? (
                <p className="text-xs text-gray-400">
                  Semua termin sudah memiliki invoice aktif.
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-gray-600">Label</p>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Mis. DP 50%"
                className="h-9 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-gray-600">Nominal</p>
                <RupiahInput
                  value={amount}
                  onValueChange={setAmount}
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-gray-600">Jatuh tempo</p>
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="h-9 text-sm"
                />
              </div>
            </div>
            {amountNumber > 0 ? (
              <div className="space-y-1 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                {withPpn ? (
                  <>
                    <p className="flex justify-between">
                      <span>DPP</span>
                      <span>{formatRupiah(dpp)}</span>
                    </p>
                    <p className="flex justify-between">
                      <span>PPN {reference?.ppn_persen}% (sudah termasuk)</span>
                      <span>{formatRupiah(amountNumber - dpp)}</span>
                    </p>
                  </>
                ) : null}
                <p className="flex justify-between font-semibold text-gray-900">
                  <span>Total tagihan</span>
                  <span>{formatRupiah(amountNumber)}</span>
                </p>
              </div>
            ) : null}
          </DialogPanelBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setFormOpen(false)}
              className="h-9 rounded-lg"
            >
              Batal
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={
                createMutation.isPending || !label.trim() || !(amountNumber > 0)
              }
              className="h-9 rounded-lg bg-pink-600 text-white hover:bg-pink-700"
            >
              {createMutation.isPending ? "Mengirim…" : "Ajukan ke Finance"}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>
    </div>
  );
}
