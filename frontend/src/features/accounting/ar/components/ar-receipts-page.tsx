"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
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
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { formatNumber } from "@/lib/format";
import { AR_RECEIPT_METHODS } from "@/lib/accounting/ar-types";
import type { ArInvoiceRow } from "@/lib/accounting/ar-types";
import { useCreateArReceipt } from "../mutations";
import {
  useArInvoiceBySalesInvoice,
  useArInvoiceList,
  useArReceiptList,
} from "../queries";
import { AR_ROUTES } from "../api";
import { useDebouncedSearch } from "@/features/accounting/shared/use-debounced-search";

export function ArReceiptsPage() {
  const searchParams = useSearchParams();
  const invoiceParam = searchParams.get("invoice");
  const salesInvoiceParam = searchParams.get("sales_invoice");
  const {
    query: searchQuery,
    setQuery: setSearchQuery,
    search,
  } = useDebouncedSearch();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ArInvoiceRow | null>(null);
  // ?invoice= / ?sales_invoice= membuka dialog sekali begitu invoice-nya termuat.
  const [deepLinkDismissed, setDeepLinkDismissed] = useState(false);
  const salesInvoiceQuery = useArInvoiceBySalesInvoice(salesInvoiceParam);

  const { data, isLoading } = useArReceiptList({
    search: search || undefined,
    limit: 50,
  });
  const openQ = useArInvoiceList({ payment_status: "unpaid", limit: 100 });
  const partialQ = useArInvoiceList({ payment_status: "partial", limit: 100 });
  const overdueQ = useArInvoiceList({ payment_status: "overdue", limit: 100 });

  const openInvoices = useMemo(() => {
    const all = [
      ...(openQ.data?.data ?? []),
      ...(partialQ.data?.data ?? []),
      ...(overdueQ.data?.data ?? []),
    ];
    const seen = new Set<string>();
    return all.filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return (r.outstanding_amount ?? 0) > 0.009;
    });
  }, [openQ.data, partialQ.data, overdueQ.data]);

  const deepLinkInvoice = deepLinkDismissed
    ? null
    : (salesInvoiceQuery.data ??
      (invoiceParam
        ? openInvoices.find((r) => r.id === invoiceParam)
        : undefined) ??
      null);
  const dialogInitial = deepLinkInvoice ?? selected;

  function setDialogOpen(next: boolean) {
    setOpen(next);
    if (!next) setDeepLinkDismissed(true);
  }

  const rows = data?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">AR Receipt</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Satu-satunya pintu penerimaan piutang
          </p>
        </div>
        <Button
          type="button"
          className="h-10 bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={() => {
            setSelected(null);
            setDeepLinkDismissed(true);
            setOpen(true);
          }}
        >
          Catat Penerimaan
        </Button>
      </div>

      <PurchasingListSection
        icon={BanknotesIcon}
        title="Riwayat Receipt"
        description="Dual-write ke payment funnel + jurnal SALE_AR_RECEIPT."
        toolbar={
          <label className="relative min-w-[180px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Cari no receipt..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-10 bg-card pl-9 pr-9 text-sm focus:border-primary/40 focus:ring-1 focus:ring-primary/30"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </label>
        }
      >
        {isLoading ? (
          <div className="py-14 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand-text" />
          </div>
        ) : rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            Belum ada receipt. Outstanding:{" "}
            <Link
              href={AR_ROUTES.receivable}
              className="text-brand-text hover:underline"
            >
              Receivable
            </Link>
          </p>
        ) : (
          <div className="overflow-x-auto px-4">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-gray-200/70 text-left text-muted-foreground">
                  <th className="px-2 py-3 font-medium">Receipt</th>
                  <th className="px-2 py-3 font-medium">Customer</th>
                  <th className="px-2 py-3 font-medium">Invoice</th>
                  <th className="px-2 py-3 font-medium">Tanggal</th>
                  <th className="px-2 py-3 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-gray-200/70 hover:bg-muted/40"
                  >
                    <td className="px-2 py-3 font-medium">{row.receipt_no}</td>
                    <td className="px-2 py-3">{row.customer_name || "—"}</td>
                    <td className="px-2 py-3 text-muted-foreground">
                      {(row.invoice_nos || []).join(", ") || "—"}
                    </td>
                    <td className="px-2 py-3">{row.receipt_date}</td>
                    <td className="px-2 py-3 text-right">
                      {formatNumber(row.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PurchasingListSection>

      <ReceiptDialog
        open={open || deepLinkInvoice !== null}
        onOpenChange={setDialogOpen}
        invoices={
          dialogInitial && !openInvoices.some((i) => i.id === dialogInitial.id)
            ? [dialogInitial, ...openInvoices]
            : openInvoices
        }
        initial={dialogInitial}
      />
    </div>
  );
}

type ReceiptDialogProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  invoices: ArInvoiceRow[];
  initial: ArInvoiceRow | null;
};

function ReceiptDialog({
  open,
  onOpenChange,
  ...formProps
}: ReceiptDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPanel size="sm">
        {/* Form dipasang ulang tiap dialog dibuka supaya isinya mulai dari invoice terpilih. */}
        {open ? (
          <ReceiptForm onClose={() => onOpenChange(false)} {...formProps} />
        ) : null}
      </DialogPanel>
    </Dialog>
  );
}

function ReceiptForm({
  invoices,
  initial,
  onClose,
}: Omit<ReceiptDialogProps, "open" | "onOpenChange"> & {
  onClose: () => void;
}) {
  const mutation = useCreateArReceipt();
  const start = initial || invoices[0] || null;
  const [invoiceId, setInvoiceId] = useState(start?.id || "");
  const [amount, setAmount] = useState<number | undefined>(
    start?.outstanding_amount,
  );
  const [receiptDate, setReceiptDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [method, setMethod] = useState<string>("transfer");
  const [notes, setNotes] = useState("");

  const selected = invoices.find((i) => i.id === invoiceId);
  const outstanding = selected?.outstanding_amount ?? 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!invoiceId || !amount || amount <= 0 || mutation.isPending) return;
    try {
      const res = await mutation.mutateAsync({
        invoice_id: invoiceId,
        amount,
        receipt_date: receiptDate,
        method,
        notes: notes || null,
      });
      toast.success(res.message || "Receipt berhasil");
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Gagal mencatat receipt",
      );
    }
  }

  return (
    <DialogPanelForm onSubmit={onSubmit}>
      <DialogPanelHeader>
        <DialogPanelTitle>Catat Penerimaan AR</DialogPanelTitle>
        <DialogPanelDescription>
          Mengurangi outstanding piutang dan memposting jurnal via mapping.
        </DialogPanelDescription>
      </DialogPanelHeader>
      <DialogPanelBody className="space-y-4">
        <div className="space-y-2">
          <Label>AR Invoice</Label>
          <Combobox
            options={invoices.map((i) => ({
              value: i.id,
              label: `${i.invoice_no} — ${i.customer_name || "Customer"} (${formatNumber(i.outstanding_amount || 0)})`,
            }))}
            value={invoiceId}
            onChange={(v) => {
              setInvoiceId(v);
              const inv = invoices.find((i) => i.id === v);
              setAmount(inv?.outstanding_amount);
            }}
            placeholder="Pilih invoice"
            searchPlaceholder="Cari..."
            className="h-10 w-full bg-card"
          />
        </div>
        <div className="space-y-2">
          <Label>Tanggal</Label>
          <Input
            type="date"
            value={receiptDate}
            onChange={(e) => setReceiptDate(e.target.value)}
            className="h-10 bg-card focus:border-primary/40 focus:ring-1 focus:ring-primary/30"
          />
        </div>
        <div className="space-y-2">
          <Label>Amount (outstanding {formatNumber(outstanding)})</Label>
          <NumericInput
            value={amount}
            onValueChange={setAmount}
            className="h-10 bg-card"
          />
        </div>
        <div className="space-y-2">
          <Label>Metode</Label>
          <Combobox
            options={AR_RECEIPT_METHODS.map((m) => ({ value: m, label: m }))}
            value={method}
            onChange={setMethod}
            placeholder="Metode"
            searchPlaceholder="Cari..."
            className="h-10 w-full bg-card"
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
          onClick={onClose}
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
            "Simpan Receipt"
          )}
        </Button>
      </DialogFooter>
    </DialogPanelForm>
  );
}
