"use client";

import { ChartBarIcon } from "@heroicons/react/24/outline";
import { Loader2 } from "lucide-react";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { formatNumber } from "@/lib/format";
import { useApAging } from "../queries";

const BUCKET_LABELS: Record<string, string> = {
  current: "Current (belum jatuh tempo)",
  "1_30": "1–30 hari",
  "31_60": "31–60 hari",
  "61_90": "61–90 hari",
  "90_plus": "> 90 hari",
};

export function ApAgingPage() {
  const { data, isLoading } = useApAging();
  const buckets = data?.buckets ?? [];
  const asOf = data?.asOf;

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200/70 pb-4">
        <h1 className="text-2xl font-bold text-foreground">AP Aging</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bucket outstanding hutang per umur{asOf ? ` (as of ${asOf})` : ""}
        </p>
      </div>

      <PurchasingListSection
        icon={ChartBarIcon}
        title="Aging Summary"
        description="Dihitung dari AP invoice outstanding di Accounting."
      >
        {isLoading ? (
          <div className="py-14 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand-text" />
          </div>
        ) : (
          <div className="overflow-x-auto px-4">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="border-b border-gray-200/70 text-left text-muted-foreground">
                  <th className="px-2 py-3 font-medium">Bucket</th>
                  <th className="px-2 py-3 font-medium text-right"># Invoice</th>
                  <th className="px-2 py-3 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {buckets.map((b) => (
                  <tr
                    key={b.bucket}
                    className="border-b border-gray-200/70 hover:bg-muted/40"
                  >
                    <td className="px-2 py-3">
                      {BUCKET_LABELS[b.bucket] || b.bucket}
                    </td>
                    <td className="px-2 py-3 text-right">{b.invoice_count}</td>
                    <td className="px-2 py-3 text-right">
                      {formatNumber(b.amount)}
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
