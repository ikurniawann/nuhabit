"use client";

import { useMemo } from "react";
import Link from "next/link";
import { DocumentTextIcon } from "@heroicons/react/24/outline";
import { Loader2, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { formatNumber } from "@/lib/format";
import { useArInvoiceList } from "../queries";
import { AR_ROUTES } from "../api";
import { useDebouncedSearch } from "@/features/accounting/shared/use-debounced-search";

export function ArInvoicesPage() {
  const { query: searchQuery, setQuery: setSearchQuery, search } = useDebouncedSearch();

  const filters = useMemo(
    () => ({ search: search || undefined, limit: 50 }),
    [search]
  );
  const { data, isLoading } = useArInvoiceList(filters);
  const rows = data?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200/70 pb-4">
        <h1 className="text-2xl font-bold text-foreground">AR Invoice</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Register piutang Accounting (dari Invoice B2B yang diterbitkan).{" "}
          <Link href={AR_ROUTES.invoicesB2b} className="text-brand-text hover:underline">
            Kelola terbit B2B
          </Link>
        </p>
      </div>
      <PurchasingListSection
        icon={DocumentTextIcon}
        title="Daftar AR Invoice"
        description="Otomatis dibuat saat Finance menerbitkan invoice B2B (terkirim)."
        toolbar={
          <label className="relative min-w-[180px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Cari no / customer / deal..."
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
            Belum ada AR invoice. Terbitkan Invoice B2B dulu.
          </p>
        ) : (
          <div className="overflow-x-auto px-4">
            <table className="w-full min-w-[800px] text-sm">
              <thead>
                <tr className="border-b border-gray-200/70 text-left text-muted-foreground">
                  <th className="px-2 py-3 font-medium">Invoice</th>
                  <th className="px-2 py-3 font-medium">Customer</th>
                  <th className="px-2 py-3 font-medium">Deal</th>
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
                    <td className="px-2 py-3 font-medium">{row.invoice_no}</td>
                    <td className="px-2 py-3">{row.customer_name || "—"}</td>
                    <td className="px-2 py-3 text-muted-foreground">
                      {row.deal_title || "—"}
                    </td>
                    <td className="px-2 py-3 text-right">
                      {formatNumber(row.total_amount)}
                    </td>
                    <td className="px-2 py-3 text-right">
                      {formatNumber(row.outstanding_amount || 0)}
                    </td>
                    <td className="px-2 py-3">
                      <Badge variant="outline">{row.payment_status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PurchasingListSection>
    </div>
  );
}
