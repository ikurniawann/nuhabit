"use client";

import { useState } from "react";
import { BanknotesIcon } from "@heroicons/react/24/outline";
import {
  FileDown,
  Loader2,
  Search,
  Send,
  Trash2,
  Wallet,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { useDeleteInvoice, useFinanceInvoices, useUpdateInvoiceStatus } from "../queries";
import { formatDate, formatRupiah } from "@/lib/format";
import { INVOICE_PAYMENT_BADGES, INVOICE_STATUS_BADGES } from "../status";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AR_ROUTES } from "@/features/accounting/ar/api";

/**
 * Modul Finance — Invoice & Pembayaran (EPIC-025 Opsi B): pengajuan sales
 * masuk sebagai 'diajukan'; finance menerbitkan (terkirim), menolak (batal),
 * dan mencatat pembayaran per invoice. Pipeline sales hanya membaca status.
 */

const STATUS_FILTERS = [
  { value: "semua", label: "Semua status" },
  { value: "diajukan", label: "Diajukan" },
  { value: "draft", label: "Draft" },
  { value: "terkirim", label: "Terkirim" },
  { value: "batal", label: "Batal" },
];

export function FinanceInvoicesPage() {
  const router = useRouter();
  const [status, setStatus] = useState("semua");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const detailHref = (id: string) => `${AR_ROUTES.invoicesB2b}/${id}`;

  const filters = { status: status === "semua" ? "" : status, q };
  const invoicesQuery = useFinanceInvoices(filters);
  const updateMutation = useUpdateInvoiceStatus();
  const deleteMutation = useDeleteInvoice();

  const invoices = invoicesQuery.data ?? [];
  const pendingCount = invoices.filter((i) => i.status === "diajukan").length;

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200/70 pb-4">
        <h1 className="text-2xl font-bold text-gray-900">Invoice B2B</h1>
        <p className="mt-1 text-sm text-gray-500">
          Pengajuan invoice funnel (sales) diterbitkan dan pembayarannya dicatat
          di sini
          {pendingCount > 0
            ? ` — ${pendingCount} pengajuan menunggu diproses.`
            : "."}
        </p>
      </div>

      <PurchasingListSection
        icon={BanknotesIcon}
        title="Daftar Invoice"
        description="Terbitkan pengajuan sales, unduh PDF, dan catat pembayaran per invoice."
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setQ(search.trim());
                }}
                placeholder="Cari no. invoice / instansi..."
                className="h-9 w-56 pl-8 text-sm"
              />
            </div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-9 w-40" aria-label="Filter status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTERS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      >
        {invoicesQuery.isLoading ? (
          <div className="py-14 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" />
            <p className="mt-2 text-sm text-gray-500">Memuat invoice...</p>
          </div>
        ) : invoices.length === 0 ? (
          <div className="py-14 text-center">
            <BanknotesIcon className="mx-auto mb-4 h-12 w-12 text-gray-300" />
            <p className="text-gray-500">
              Belum ada invoice — pengajuan sales akan muncul di sini.
            </p>
          </div>
        ) : (
          <ul className="space-y-2.5 px-4 py-4">
            {invoices.map((invoice) => (
              <li
                key={invoice.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200/80 bg-white p-3.5"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    href={detailHref(invoice.id)}
                    title="Buka dokumen invoice"
                    className="text-left text-sm font-semibold text-gray-900 hover:text-pink-600 hover:underline"
                  >
                    {invoice.invoice_number}
                    <span className="ml-1.5 font-normal text-gray-500">
                      {invoice.label}
                    </span>
                  </Link>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {invoice.org_name} · {invoice.deal_title}
                    {invoice.quote_number ? ` · ${invoice.quote_number}` : ""}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-400">
                    Jatuh tempo {formatDate(invoice.due_date, "—")}
                    {invoice.created_by_name
                      ? ` · diajukan ${invoice.created_by_name}`
                      : ""}
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Badge
                      className={`border-0 font-normal ${INVOICE_STATUS_BADGES[invoice.status]}`}
                    >
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
                    {invoice.paid > 0
                      ? `${formatRupiah(invoice.paid)} / `
                      : ""}
                    {formatRupiah(invoice.amount)}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {invoice.status === "diajukan" || invoice.status === "draft" ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() =>
                        updateMutation.mutate({
                          invoiceId: invoice.id,
                          status: "terkirim",
                        })
                      }
                      disabled={updateMutation.isPending}
                      className="h-8 gap-1.5 rounded-lg bg-pink-600 text-white hover:bg-pink-700"
                    >
                      <Send className="h-3.5 w-3.5" /> Terbitkan
                    </Button>
                  ) : null}
                  {invoice.status === "terkirim" &&
                  invoice.payment_status !== "lunas" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        router.push(`${AR_ROUTES.receipts}?sales_invoice=${invoice.id}`)
                      }
                      className="h-8 gap-1.5 rounded-lg border-primary/20 text-brand-text hover:bg-primary/5"
                    >
                      <Wallet className="h-3.5 w-3.5" /> Terima di Accounting
                    </Button>
                  ) : null}
                  {invoice.paid > 0 ? (
                    <Button asChild size="sm" variant="outline" className="h-8 rounded-lg">
                      {/* Riwayat pembayaran ada di halaman dokumen invoice */}
                      <Link href={detailHref(invoice.id)}>Riwayat</Link>
                    </Button>
                  ) : null}
                  <a
                    href={`/api/sales-funnel/invoices/${invoice.id}/pdf`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Unduh PDF"
                    className="p-1 text-gray-400 hover:text-pink-600"
                  >
                    <FileDown className="h-4 w-4" />
                  </a>
                  {invoice.status !== "batal" && invoice.paid === 0 ? (
                    <button
                      type="button"
                      onClick={() =>
                        updateMutation.mutate({
                          invoiceId: invoice.id,
                          status: "batal",
                        })
                      }
                      title="Batalkan / tolak pengajuan"
                      className="p-1 text-gray-300 hover:text-amber-600"
                    >
                      <XCircle className="h-4 w-4" />
                    </button>
                  ) : null}
                  {invoice.paid === 0 ? (
                    <button
                      type="button"
                      onClick={() => deleteMutation.mutate(invoice.id)}
                      title="Hapus invoice"
                      className="p-1 text-gray-300 hover:text-red-500"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </PurchasingListSection>

    </div>
  );
}
