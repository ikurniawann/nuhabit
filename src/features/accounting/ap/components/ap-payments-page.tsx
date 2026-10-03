"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BanknotesIcon } from "@heroicons/react/24/outline";
import { Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Combobox } from "@/components/ui/combobox";
import { NumericInput } from "@/components/ui/numeric-input";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelForm,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { PurchasingListSection } from "@/modules/purchasing/components/list/PurchasingListSection";
import { formatAmount } from "@/lib/purchasing/utils";
import { AP_PAYMENT_METHODS } from "@/lib/accounting/ap-types";
import { useCreateApPayment } from "../mutations";
import { useApInvoiceList, useApPaymentList } from "../queries";
import type { ApInvoiceRow } from "../routes";
import { ApPaymentVoidButton } from "@/features/purchasing/vendor-payments/components/ap-payment-void-button";

export function ApPaymentsPage() {
  const searchParams = useSearchParams();
  const invoiceParam = searchParams.get("invoice");
  const [searchQuery, setSearchQuery] = useState("");
  const [search, setSearch] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<ApInvoiceRow | null>(
    null
  );

  useEffect(() => {
    const t = window.setTimeout(() => setSearch(searchQuery.trim()), 300);
    return () => window.clearTimeout(t);
  }, [searchQuery]);

  const { data, isLoading } = useApPaymentList({
    search: search || undefined,
    limit: 50,
  });
  const rows = data?.data ?? [];

  const openInvoicesQuery = useApInvoiceList({
    payment_status: "unpaid",
    limit: 100,
  });
  const partialInvoicesQuery = useApInvoiceList({
    payment_status: "partial",
    limit: 100,
  });
  const overdueInvoicesQuery = useApInvoiceList({
    payment_status: "overdue",
    limit: 100,
  });

  const openInvoices = useMemo(() => {
    const all = [
      ...(openInvoicesQuery.data?.data ?? []),
      ...(partialInvoicesQuery.data?.data ?? []),
      ...(overdueInvoicesQuery.data?.data ?? []),
    ];
    const seen = new Set<string>();
    return all.filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return (r.outstanding_amount ?? 0) > 0.009;
    });
  }, [
    openInvoicesQuery.data,
    partialInvoicesQuery.data,
    overdueInvoicesQuery.data,
  ]);

  useEffect(() => {
    if (!invoiceParam || openInvoices.length === 0) return;
    const match = openInvoices.find((r) => r.id === invoiceParam);
    if (match) {
      setSelectedInvoice(match);
      setPayOpen(true);
    }
  }, [invoiceParam, openInvoices]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-foreground">AP Payment</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Satu-satunya pintu pembayaran hutang vendor
          </p>
        </div>
        <Button
          type="button"
          onClick={() => {
            setSelectedInvoice(null);
            setPayOpen(true);
          }}
          className="h-10 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
        >
          Catat Pembayaran
        </Button>
      </div>

      <PurchasingListSection
        icon={BanknotesIcon}
        title="Riwayat Pembayaran"
        description="Posting jurnal via Journal Mapping PURCHASE_PAYMENT."
        toolbar={
          <label className="relative min-w-[180px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Cari no pembayaran / vendor..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-10 bg-card pl-9 pr-9 text-sm focus:border-primary/40 focus:ring-1 focus:ring-primary/30"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                aria-label="Clear"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </label>
        }
      >
        {isLoading ? (
          <div className="py-14 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
          </div>
        ) : rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            Belum ada pembayaran AP.
          </p>
        ) : (
          <div className="overflow-x-auto px-4">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-gray-200/70 text-left text-muted-foreground">
                  <th className="px-2 py-3 font-medium">Payment</th>
                  <th className="px-2 py-3 font-medium">Vendor</th>
                  <th className="px-2 py-3 font-medium">Invoice</th>
                  <th className="px-2 py-3 font-medium">Tanggal</th>
                  <th className="px-2 py-3 font-medium">Metode</th>
                  <th className="px-2 py-3 font-medium text-right">Amount</th>
                  <th className="px-2 py-3 font-medium text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-gray-200/70 hover:bg-muted/40"
                  >
                    <td className="px-2 py-3 font-medium">{row.payment_no}</td>
                    <td className="px-2 py-3">{row.party_name || "—"}</td>
                    <td className="px-2 py-3 text-muted-foreground">
                      {(row.invoice_nos || []).join(", ") || "—"}
                    </td>
                    <td className="px-2 py-3">{row.payment_date}</td>
                    <td className="px-2 py-3">{row.method}</td>
                    <td className="px-2 py-3 text-right">
                      {formatAmount(row.amount)}
                    </td>
                    <td className="px-2 py-3 text-right">
                      <ApPaymentVoidButton payment={row} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PurchasingListSection>

      <ApPayDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        invoices={openInvoices}
        initialInvoice={selectedInvoice}
      />
    </div>
  );
}

function ApPayDialog({
  open,
  onOpenChange,
  invoices,
  initialInvoice,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  invoices: ApInvoiceRow[];
  initialInvoice: ApInvoiceRow | null;
}) {
  const mutation = useCreateApPayment();
  const [invoiceId, setInvoiceId] = useState("");
  const [amount, setAmount] = useState<number | undefined>();
  const [paymentDate, setPaymentDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [method, setMethod] = useState<string>("bank_transfer");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  const selected = invoices.find((i) => i.id === invoiceId) || null;
  const outstanding = selected?.outstanding_amount ?? 0;

  useEffect(() => {
    if (!open) return;
    const inv = initialInvoice || invoices[0] || null;
    setInvoiceId(inv?.id || "");
    setAmount(inv?.outstanding_amount || undefined);
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setMethod("bank_transfer");
    setReference("");
    setNotes("");
  }, [open, initialInvoice, invoices]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!invoiceId || !amount || amount <= 0 || mutation.isPending) return;
    try {
      const res = await mutation.mutateAsync({
        invoice_id: invoiceId,
        amount,
        payment_date: paymentDate,
        method,
        reference_number: reference || null,
        notes: notes || null,
      });
      toast.success(res.message || "Pembayaran berhasil");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mencatat pembayaran");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPanel size="sm">
        <DialogPanelForm onSubmit={onSubmit}>
          <DialogPanelHeader>
            <DialogPanelTitle>Catat Pembayaran AP</DialogPanelTitle>
            <DialogPanelDescription>
              Membayar invoice Accounting. Jurnal diposting via Journal Mapping.
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="space-y-4">
            <div className="space-y-2">
              <Label>AP Invoice</Label>
              <Combobox
                options={invoices.map((i) => ({
                  value: i.id,
                  label: `${i.invoice_no} — ${i.party_name || "Vendor"} (${formatAmount(i.outstanding_amount || 0)})`,
                }))}
                value={invoiceId}
                onChange={(v) => {
                  setInvoiceId(v);
                  const inv = invoices.find((i) => i.id === v);
                  setAmount(inv?.outstanding_amount || undefined);
                }}
                placeholder="Pilih invoice"
                searchPlaceholder="Cari invoice..."
                className="h-10 w-full bg-card"
              />
            </div>
            <div className="space-y-2">
              <Label>Tanggal bayar</Label>
              <Input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="h-10 bg-card focus:border-primary/40 focus:ring-1 focus:ring-primary/30"
              />
            </div>
            <div className="space-y-2">
              <Label>Amount (outstanding {formatAmount(outstanding)})</Label>
              <NumericInput
                value={amount}
                onValueChange={setAmount}
                className="h-10 bg-card"
              />
            </div>
            <div className="space-y-2">
              <Label>Metode</Label>
              <Combobox
                options={AP_PAYMENT_METHODS.map((m) => ({
                  value: m,
                  label: m,
                }))}
                value={method}
                onChange={setMethod}
                placeholder="Metode"
                searchPlaceholder="Cari..."
                className="h-10 w-full bg-card"
              />
            </div>
            <div className="space-y-2">
              <Label>Referensi</Label>
              <Input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className="h-10 bg-card focus:border-primary/40 focus:ring-1 focus:ring-primary/30"
              />
            </div>
            <div className="space-y-2">
              <Label>Catatan</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="h-10 bg-card focus:border-primary/40 focus:ring-1 focus:ring-primary/30"
              />
            </div>
          </DialogPanelBody>
          <DialogFooter className="gap-3 px-6 py-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              Batal
            </Button>
            <Button type="submit" disabled={mutation.isPending || !invoiceId}>
              {mutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Menyimpan...
                </>
              ) : (
                "Simpan Pembayaran"
              )}
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}
