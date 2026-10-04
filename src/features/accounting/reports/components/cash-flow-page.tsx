"use client";

import { useState } from "react";
import { BanknotesIcon } from "@heroicons/react/24/outline";
import { useCashFlow } from "../queries";
import type { CashFlowSection } from "../types";
import {
  PeriodFilter,
  ReportShell,
  todayStr,
  yearStartStr,
} from "./report-shell";
import {
  AccountBalanceTable,
  ErrorBlock,
  LoadingBlock,
  SectionTitle,
  SummaryRow,
} from "./report-table";
import { formatLedgerAmount } from "@/lib/accounting/format";

function CfSection({
  title,
  section,
}: {
  title: string;
  section: CashFlowSection;
}) {
  return (
    <section className="space-y-3">
      <SectionTitle title={title} total={section.total} />
      <AccountBalanceTable
        rows={section.rows}
        emptyMessage="Tidak ada akun di kategori ini"
      />
    </section>
  );
}

export function CashFlowPage() {
  const [dateFrom, setDateFrom] = useState(yearStartStr());
  const [dateTo, setDateTo] = useState(todayStr());
  const { data, isLoading, isError, error } = useCashFlow(dateFrom, dateTo);

  return (
    <ReportShell
      icon={BanknotesIcon}
      title="Cash Flow"
      description={`Arus kas ${dateFrom} s/d ${dateTo}`}
      toolbar={
        <PeriodFilter
          dateFrom={dateFrom}
          dateTo={dateTo}
          onFrom={setDateFrom}
          onTo={setDateTo}
        />
      }
    >
      <div className="space-y-6 px-4 pb-4">
        {isLoading ? (
          <LoadingBlock label="Memuat Cash Flow..." />
        ) : isError ? (
          <ErrorBlock
            message={
              error instanceof Error ? error.message : "Gagal memuat Cash Flow"
            }
          />
        ) : !data ? (
          <ErrorBlock message="Data tidak tersedia untuk company Anda." />
        ) : (
          <>
            <div className="flex flex-wrap gap-4 border-b border-gray-200/70 pb-3 text-sm">
              <div>
                Opening Cash:{" "}
                <span className="font-medium tabular-nums">
                  {formatLedgerAmount(data.cash_opening)}
                </span>
              </div>
              <div>
                Closing Cash:{" "}
                <span className="font-medium tabular-nums">
                  {formatLedgerAmount(data.cash_closing)}
                </span>
              </div>
            </div>

            <CfSection title="Operating" section={data.operating} />
            <CfSection title="Investing" section={data.investing} />
            <CfSection title="Financing" section={data.financing} />
            <CfSection title="Non-Cash" section={data.non_cash} />

            <div className="space-y-1 border-t border-gray-200/70 pt-3">
              <SummaryRow
                label="Net Change in Cash"
                value={data.net_cash_change}
                emphasize
              />
              <SummaryRow label="Cash Opening" value={data.cash_opening} />
              <SummaryRow label="Cash Closing" value={data.cash_closing} />
            </div>
          </>
        )}
      </div>
    </ReportShell>
  );
}
