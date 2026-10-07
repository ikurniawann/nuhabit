"use client";

import { useState } from "react";
import { DocumentChartBarIcon } from "@heroicons/react/24/outline";
import { useIncomeStatement } from "../queries";
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

export function IncomeStatementPage() {
  const [dateFrom, setDateFrom] = useState(yearStartStr());
  const [dateTo, setDateTo] = useState(todayStr());
  const { data, isLoading, isError, error } = useIncomeStatement(
    dateFrom,
    dateTo,
  );

  return (
    <ReportShell
      icon={DocumentChartBarIcon}
      title="Income Statement"
      description={`Laba rugi ${dateFrom} s/d ${dateTo}`}
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
          <LoadingBlock label="Memuat Income Statement..." />
        ) : isError ? (
          <ErrorBlock
            message={
              error instanceof Error
                ? error.message
                : "Gagal memuat Income Statement"
            }
          />
        ) : !data ? (
          <ErrorBlock message="Data tidak tersedia untuk company Anda." />
        ) : (
          <>
            <section className="space-y-3">
              <SectionTitle title="Revenue" total={data.total_revenue} />
              <AccountBalanceTable rows={data.revenue} />
            </section>

            <section className="space-y-3">
              <SectionTitle
                title="Cost of Goods Sold"
                total={data.total_cogs}
              />
              <AccountBalanceTable rows={data.cogs} />
              <SummaryRow
                label="Gross Profit"
                value={data.gross_profit}
                emphasize
              />
            </section>

            <section className="space-y-3">
              <SectionTitle
                title="Operating Expenses"
                total={data.total_expenses}
              />
              <AccountBalanceTable rows={data.expenses} />
              <SummaryRow
                label="Operating Income"
                value={data.operating_income}
                emphasize
              />
            </section>

            <section className="space-y-3">
              <SectionTitle
                title="Other Income"
                total={data.total_other_income}
              />
              <AccountBalanceTable rows={data.other_income} />
            </section>

            <section className="space-y-3">
              <SectionTitle
                title="Other Expenses"
                total={data.total_other_expenses}
              />
              <AccountBalanceTable rows={data.other_expenses} />
            </section>

            <div className="border-t border-gray-200/70 pt-3">
              <SummaryRow
                label="Net Income"
                value={data.net_income}
                emphasize
              />
            </div>
          </>
        )}
      </div>
    </ReportShell>
  );
}
