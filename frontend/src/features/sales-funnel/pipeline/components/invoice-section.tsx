"use client";

import { formatDate, formatRupiah } from "@/lib/format";
import { useState } from "react";
import { FileCheck2, FileDown, Loader2, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDealInvoices, useDeleteDealInvoice } from "../queries";
import { INVOICE_PAYMENT_BADGES, INVOICE_STATUS_BADGES } from "@/features/finance/invoices/status";
import { InvoiceRequestSheet } from "./invoice-request-sheet";

/**
 * Pengajuan invoice per deal (EPIC-025 Opsi B): sales MENGAJUKAN invoice
 * dari kesepakatan termin quotation acuan di lembar invoice; penerbitan,
 * batal, dan pencatatan pembayaran diproses modul Finance. PPN mengikuti
 * setelan quotation: nominal termin sudah termasuk PPN, rincian DPP/PPN
 * hanya informatif.
 */

export function InvoiceSection({
  dealId,
  enabled,
}: {
  dealId: string;
  enabled: boolean;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const invoicesQuery = useDealInvoices(dealId, enabled);
  const deleteMutation = useDeleteDealInvoice(dealId);

  const data = invoicesQuery.data;
  const invoices = data?.invoices ?? [];
  const reference = data?.reference ?? null;

  return (
    <div className="space-y-2.5 border-b border-gray-100 px-6 py-4">
      <div className="flex items-center justify-between">
        <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-900">
          <FileCheck2 className="h-4 w-4 text-pink-500" /> Invoice
        </p>
        <Button type="button" size="sm" onClick={() => setFormOpen(true)}>
          <Plus /> Ajukan Invoice
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
                  <Badge className={`border-0 font-normal ${INVOICE_STATUS_BADGES[invoice.status]}`}>
                    {invoice.status}
                  </Badge>
                  {invoice.status !== "batal" ? (
                    <Badge
                      className={`border-0 font-normal ${INVOICE_PAYMENT_BADGES[invoice.payment_status]}`}
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

      <InvoiceRequestSheet dealId={dealId} data={data} open={formOpen} onOpenChange={setFormOpen} />
    </div>
  );
}
