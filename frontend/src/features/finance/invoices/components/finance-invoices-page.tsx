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
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { RupiahInput } from "@/features/sales-funnel/pipeline/components/rupiah-input";
import { InvoiceDetailDialog } from "./invoice-detail-dialog";
import {
  useCreateInvoicePayment,
  useDeleteInvoice,
  useDeleteInvoicePayment,
  useFinanceInvoices,
  useInvoicePayments,
  useUpdateInvoiceStatus,
} from "../queries";
import type { FinanceInvoice } from "../api";
import { formatDate, formatRupiah } from "@/lib/format";
import { useRouter } from "next/navigation";
import { AR_ROUTES } from "@/features/accounting/ar/api";

/**
 * Modul Finance — Invoice & Pembayaran (EPIC-025 Opsi B): pengajuan sales
 * masuk sebagai 'diajukan'; finance menerbitkan (terkirim), menolak (batal),
 * dan mencatat pembayaran per invoice. Pipeline sales hanya membaca status.
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

const METHOD_LABELS: Record<string, string> = {
  cash: "Tunai",
  transfer: "Transfer",
  qris: "QRIS",
  edc: "Kartu / EDC",
  lainnya: "Lainnya",
};

const STATUS_FILTERS = [
  { value: "semua", label: "Semua status" },
  { value: "diajukan", label: "Diajukan" },
  { value: "draft", label: "Draft" },
  { value: "terkirim", label: "Terkirim" },
  { value: "batal", label: "Batal" },
];

const todayInput = () => {
  const now = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
};


/** Popup catat pembayaran + riwayat per invoice. */
function PaymentDialog({
  invoice,
  onClose,
}: {
  invoice: FinanceInvoice | null;
  onClose: () => void;
}) {
  const open = invoice !== null;
  const invoiceId = invoice?.id ?? "";
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("transfer");
  const [paidOn, setPaidOn] = useState(todayInput);
  const [note, setNote] = useState("");

  const paymentsQuery = useInvoicePayments(invoiceId, open);
  const createMutation = useCreateInvoicePayment(invoiceId, () => {
    setAmount("");
    setNote("");
  });
  const deleteMutation = useDeleteInvoicePayment();

  const payments = paymentsQuery.data ?? [];

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setAmount("");
      setNote("");
      onClose();
    }
  };

  const handleSubmit = () => {
    const value = Number(amount) || 0;
    if (value <= 0 || !paidOn || createMutation.isPending) return;
    createMutation.mutate({
      amount: value,
      method,
      paid_on: paidOn,
      note: note.trim() || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPanel size="sm">
        {invoice ? (
          <>
            <DialogPanelHeader>
              <DialogPanelTitle>
                Pembayaran {invoice.invoice_number}
              </DialogPanelTitle>
              <p className="text-xs text-gray-500">
                {invoice.org_name} · {invoice.label} —{" "}
                {formatRupiah(invoice.amount)}
                {invoice.outstanding > 0
                  ? ` · sisa ${formatRupiah(invoice.outstanding)}`
                  : " · lunas"}
              </p>
            </DialogPanelHeader>
            <DialogPanelBody className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <RupiahInput
                  value={amount}
                  onValueChange={setAmount}
                  placeholder="Nominal (Rp)"
                  className="h-9 text-sm"
                />
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(METHOD_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="date"
                  value={paidOn}
                  onChange={(e) => setPaidOn(e.target.value)}
                  className="h-9 text-sm"
                />
                <Button
                  type="button"
                  onClick={handleSubmit}
                  disabled={
                    createMutation.isPending || !(Number(amount) > 0) || !paidOn
                  }
                  className="h-9 rounded-lg bg-pink-600 text-white hover:bg-pink-700"
                >
                  {createMutation.isPending ? "Menyimpan…" : "Catat"}
                </Button>
              </div>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Catatan (mis. transfer BCA a.n. Budi)"
                className="h-9 text-sm"
              />

              <div>
                <p className="mb-1.5 text-xs font-medium text-gray-600">
                  Riwayat pembayaran
                </p>
                {paymentsQuery.isLoading ? (
                  <div className="py-3 text-center">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-pink-600" />
                  </div>
                ) : payments.length === 0 ? (
                  <p className="text-xs text-gray-400">
                    Belum ada pembayaran untuk invoice ini.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {payments.map((payment) => (
                      <li
                        key={payment.id}
                        className="flex items-center gap-2 rounded-lg border border-gray-200/70 px-3 py-2 text-sm"
                      >
                        <span className="font-semibold text-gray-900">
                          {formatRupiah(payment.amount)}
                        </span>
                        <Badge className="border-0 bg-gray-100 font-normal text-gray-600">
                          {METHOD_LABELS[payment.method] ?? payment.method}
                        </Badge>
                        <span className="text-xs text-gray-500">
                          {formatDate(payment.paid_on, "—")}
                          {payment.note ? ` · ${payment.note}` : ""}
                        </span>
                        <button
                          type="button"
                          onClick={() => deleteMutation.mutate(payment.id)}
                          title="Hapus catatan (salah catat)"
                          className="ml-auto shrink-0 text-gray-300 hover:text-red-500"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </DialogPanelBody>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                className="h-9 rounded-lg"
              >
                Tutup
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogPanel>
    </Dialog>
  );
}

export function FinanceInvoicesPage() {
  const router = useRouter();
  const [status, setStatus] = useState("semua");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [paymentInvoice, setPaymentInvoice] = useState<FinanceInvoice | null>(
    null
  );
  const [detailInvoiceId, setDetailInvoiceId] = useState<string | null>(null);

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
              <SelectTrigger className="h-9 w-40">
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
                  <button
                    type="button"
                    onClick={() => setDetailInvoiceId(invoice.id)}
                    title="Lihat detail invoice"
                    className="text-left text-sm font-semibold text-gray-900 hover:text-pink-600 hover:underline"
                  >
                    {invoice.invoice_number}
                    <span className="ml-1.5 font-normal text-gray-500">
                      {invoice.label}
                    </span>
                  </button>
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
                      className={`border-0 font-normal ${STATUS_BADGES[invoice.status]}`}
                    >
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
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      // Riwayat = lihat saja → dialog detail (read-only,
                      // form pembayaran ada di "Catat Bayar" terpisah)
                      onClick={() => setDetailInvoiceId(invoice.id)}
                      className="h-8 rounded-lg"
                    >
                      Riwayat
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

      <PaymentDialog
        invoice={paymentInvoice}
        onClose={() => setPaymentInvoice(null)}
      />
      <InvoiceDetailDialog
        invoiceId={detailInvoiceId}
        onClose={() => setDetailInvoiceId(null)}
      />
    </div>
  );
}
