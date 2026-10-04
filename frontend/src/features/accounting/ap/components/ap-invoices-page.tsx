"use client";

import { useMemo, useState } from "react";
import { DocumentTextIcon } from "@heroicons/react/24/outline";
import { Loader2, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { filterComboboxClassName } from "@/components/layout/form-field";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { formatNumber } from "@/lib/format";
import { useApInvoiceList } from "../queries";
import type { ApInvoiceRow, ApPaymentStatus } from "../routes";
import { useDebouncedSearch } from "@/features/accounting/shared/use-debounced-search";

const PAYMENT_STATUS_LABELS: Record<ApPaymentStatus, string> = {
  unpaid: "Belum Dibayar",
  partial: "Sebagian",
  paid: "Lunas",
  overdue: "Lewat Tempo",
};

const PAYMENT_STATUS_STYLES: Record<ApPaymentStatus, string> = {
  unpaid: "border-gray-200 bg-gray-50 text-gray-700",
  partial: "border-amber-200 bg-amber-50 text-amber-700",
  paid: "border-emerald-200 bg-emerald-50 text-emerald-700",
  overdue: "border-red-200 bg-red-50 text-red-700",
};

export function ApInvoicesPage() {
  const { query: searchQuery, setQuery: setSearchQuery, search } = useDebouncedSearch();
  const [paymentStatus, setPaymentStatus] = useState("all");


  const filters = useMemo(
    () => ({
      search: search || undefined,
      payment_status: paymentStatus !== "all" ? paymentStatus : undefined,
      limit: 50,
    }),
    [search, paymentStatus]
  );

  const { data, isLoading } = useApInvoiceList(filters);
  const rows = data?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200/70 pb-4">
        <h1 className="text-2xl font-bold text-foreground">AP Invoice</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Invoice hutang vendor (Accounting) — dibuat otomatis dari GRN
        </p>
      </div>

      <PurchasingListSection
        icon={DocumentTextIcon}
        title="Daftar AP Invoice"
        description="Source of truth hutang vendor di modul Accounting."
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-[180px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Cari no invoice / PO / GRN / vendor..."
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
            <Combobox
              options={[
                { value: "all", label: "Semua status bayar" },
                { value: "unpaid", label: "Belum Dibayar" },
                { value: "partial", label: "Sebagian" },
                { value: "paid", label: "Lunas" },
                { value: "overdue", label: "Lewat Tempo" },
              ]}
              value={paymentStatus}
              onChange={setPaymentStatus}
              placeholder="Status bayar"
              searchPlaceholder="Cari..."
              className={`${filterComboboxClassName} h-10 w-[180px] shrink-0 bg-card`}
            />
          </div>
        }
      >
        {isLoading ? (
          <div className="py-14 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand-text" />
          </div>
        ) : (
          <InvoiceTable rows={rows} />
        )}
      </PurchasingListSection>
    </div>
  );
}

function InvoiceTable({ rows }: { rows: ApInvoiceRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-sm text-muted-foreground">
        Belum ada AP invoice. Selesaikan GRN agar invoice terbentuk.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto px-4">
      <table className="w-full min-w-[880px] text-sm">
        <thead>
          <tr className="border-b border-gray-200/70 text-left text-muted-foreground">
            <th className="px-2 py-3 font-medium">Invoice</th>
            <th className="px-2 py-3 font-medium">Vendor</th>
            <th className="px-2 py-3 font-medium">PO / GRN</th>
            <th className="px-2 py-3 font-medium">Tanggal</th>
            <th className="px-2 py-3 font-medium text-right">Total</th>
            <th className="px-2 py-3 font-medium text-right">Outstanding</th>
            <th className="px-2 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className="border-b border-gray-200/70 hover:bg-muted/40"
            >
              <td className="px-2 py-3 font-medium text-foreground">
                {row.invoice_no}
              </td>
              <td className="px-2 py-3">{row.party_name || "—"}</td>
              <td className="px-2 py-3 text-muted-foreground">
                {row.po_number || "—"}
                {row.grn_number ? ` / ${row.grn_number}` : ""}
              </td>
              <td className="px-2 py-3">{row.invoice_date}</td>
              <td className="px-2 py-3 text-right">
                {formatNumber(row.total_amount)}
              </td>
              <td className="px-2 py-3 text-right">
                {formatNumber(row.outstanding_amount || 0)}
              </td>
              <td className="px-2 py-3">
                <Badge
                  variant="outline"
                  className={
                    PAYMENT_STATUS_STYLES[row.payment_status || "unpaid"]
                  }
                >
                  {PAYMENT_STATUS_LABELS[row.payment_status || "unpaid"]}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
