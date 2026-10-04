"use client";

import { useState } from "react";
import { ScaleIcon } from "@heroicons/react/24/outline";
import { useBalanceSheet } from "../queries";
import { AsOfFilter, ReportShell, todayStr } from "./report-shell";
import {
  AccountBalanceTable,
  ErrorBlock,
  LoadingBlock,
  SectionTitle,
  SummaryRow,
} from "./report-table";

export function BalanceSheetPage() {
  const [asOf, setAsOf] = useState(todayStr());
  const { data, isLoading, isError, error } = useBalanceSheet(asOf);

  return (
    <ReportShell
      icon={ScaleIcon}
      title="Balance Sheet"
      description={`Posisi keuangan per ${asOf}`}
      toolbar={<AsOfFilter value={asOf} onChange={setAsOf} />}
    >
      <div className="space-y-6 px-4 pb-4">
        {isLoading ? (
          <LoadingBlock label="Memuat Balance Sheet..." />
        ) : isError ? (
          <ErrorBlock
            message={
              error instanceof Error
                ? error.message
                : "Gagal memuat Balance Sheet"
            }
          />
        ) : !data ? (
          <ErrorBlock message="Data tidak tersedia untuk company Anda." />
        ) : (
          <>
            <section className="space-y-3">
              <SectionTitle title="Assets" total={data.total_assets} />
              <AccountBalanceTable rows={data.assets} />
            </section>

            <section className="space-y-3">
              <SectionTitle
                title="Liabilities"
                total={data.total_liabilities}
              />
              <AccountBalanceTable rows={data.liabilities} />
            </section>

            <section className="space-y-3">
              <SectionTitle title="Equity" />
              <AccountBalanceTable rows={data.equity} />
              <SummaryRow
                label="Current Year Earnings"
                value={data.current_year_earnings}
              />
              <SummaryRow
                label="Total Equity"
                value={data.total_equity}
                emphasize
              />
            </section>

            <div className="space-y-1 border-t border-gray-200/70 pt-3">
              <SummaryRow label="Total Assets" value={data.total_assets} />
              <SummaryRow
                label="Total Liabilities + Equity"
                value={data.total_liabilities_and_equity}
                emphasize
              />
            </div>
          </>
        )}
      </div>
    </ReportShell>
  );
}
