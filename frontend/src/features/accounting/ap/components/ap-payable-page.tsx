"use client";

import Link from "next/link";
import { BanknotesIcon } from "@heroicons/react/24/outline";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { formatNumber } from "@/lib/format";
import { useApPayable } from "../queries";
import { AP_ROUTES } from "../routes";

export function ApPayablePage() {
  const { data, isLoading } = useApPayable();
  const rows = data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Payable</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Register outstanding hutang vendor (Accounting SoT)
          </p>
        </div>
        <Link
          href={AP_ROUTES.payments}
          className="inline-flex h-10 items-center rounded-lg border border-border px-4 text-sm text-foreground hover:bg-muted/50"
        >
          Ke AP Payment
        </Link>
      </div>

      <PurchasingListSection
        icon={BanknotesIcon}
        title="Outstanding Payable"
        description="Invoice POSTED dengan sisa outstanding > 0."
      >
        {isLoading ? (
          <div className="py-14 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand-text" />
          </div>
        ) : rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            Tidak ada hutang outstanding.
          </p>
        ) : (
          <div className="overflow-x-auto px-4">
            <table className="w-full min-w-[800px] text-sm">
              <thead>
                <tr className="border-b border-gray-200/70 text-left text-muted-foreground">
                  <th className="px-2 py-3 font-medium">Invoice</th>
                  <th className="px-2 py-3 font-medium">Vendor</th>
                  <th className="px-2 py-3 font-medium">Jatuh tempo</th>
                  <th className="px-2 py-3 font-medium text-right">Outstanding</th>
                  <th className="px-2 py-3 font-medium">Status</th>
                  <th className="px-2 py-3 text-right font-medium">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-gray-200/70 hover:bg-muted/40"
                  >
                    <td className="px-2 py-3 font-medium">{row.invoice_no}</td>
                    <td className="px-2 py-3">{row.party_name || "—"}</td>
                    <td className="px-2 py-3">{row.due_date || "—"}</td>
                    <td className="px-2 py-3 text-right">
                      {formatNumber(row.outstanding_amount || 0)}
                    </td>
                    <td className="px-2 py-3">
                      <Badge variant="outline">{row.payment_status}</Badge>
                    </td>
                    <td className="px-2 py-3 text-right">
                      <Link
                        href={`${AP_ROUTES.payments}?invoice=${row.id}`}
                        className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-xs hover:bg-muted/50"
                      >
                        Bayar
                      </Link>
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
