"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowPathIcon, ArrowRightIcon, BanknotesIcon, DocumentChartBarIcon, DocumentTextIcon, ScaleIcon, TableCellsIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { REPORT_ROUTES } from "../routes";
import { useAccountingDashboard } from "../queries";
import {
  DashboardSkeleton,
  KpiCard,
  Panel,
  StatChip,
} from "./accounting-dashboard-cards";
import { todayStr, yearStartStr } from "./report-shell";
import {
  BalanceCompositionChart,
  CashFlowChart,
  MonthlyTrendChart,
  PnlBreakdownChart,
  TopExpenseChart,
} from "./accounting-dashboard-charts";
import { formatLedgerAmount } from "@/lib/accounting/format";

const QUICK_LINKS = [
  {
    href: REPORT_ROUTES.balanceSheet,
    title: "Balance Sheet",
    description: "Posisi aset & kewajiban",
    icon: ScaleIcon,
  },
  {
    href: REPORT_ROUTES.incomeStatement,
    title: "Income Statement",
    description: "Laba rugi periode",
    icon: DocumentChartBarIcon,
  },
  {
    href: REPORT_ROUTES.cashFlow,
    title: "Cash Flow",
    description: "Arus kas operasi",
    icon: BanknotesIcon,
  },
  {
    href: REPORT_ROUTES.generalLedger,
    title: "General Ledger",
    description: "Buku besar akun",
    icon: DocumentTextIcon,
  },
  {
    href: REPORT_ROUTES.trialBalance,
    title: "Trial Balance",
    description: "Neraca saldo",
    icon: TableCellsIcon,
  },
] as const;

export function AccountingDashboardPage() {
  const [asOf, setAsOf] = useState(todayStr());
  const [dateFrom, setDateFrom] = useState(yearStartStr());
  const [dateTo, setDateTo] = useState(todayStr());

  const filters = useMemo(
    () => ({ as_of: asOf, date_from: dateFrom, date_to: dateTo }),
    [asOf, dateFrom, dateTo],
  );

  const { data, isLoading, isError, error, refetch, isFetching } =
    useAccountingDashboard(filters);

  const tbBalanced = data ? data.kpis.trial_balance_diff < 0.01 : undefined;
  const netTone = !data
    ? "default"
    : data.kpis.net_income > 0
      ? "positive"
      : data.kpis.net_income < 0
        ? "negative"
        : "default";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-gray-200/70 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-foreground">
              Accounting Dashboard
            </h1>
            <Badge
              variant="outline"
              className="border-gray-200/80 font-normal text-muted-foreground"
            >
              POSTED only
            </Badge>
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Ringkasan posisi keuangan & performa — filter periode di kanan
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:items-end">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-lg border border-gray-200/70 bg-muted/30 p-1">
              <span className="hidden px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:inline">
                Periode
              </span>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-9 w-35 border-0 bg-card text-sm shadow-none focus:border-primary/40 focus:ring-1 focus:ring-primary/30"
                aria-label="Dari"
              />
              <span className="text-xs text-muted-foreground">–</span>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-9 w-35 border-0 bg-card text-sm shadow-none focus:border-primary/40 focus:ring-1 focus:ring-primary/30"
                aria-label="Sampai"
              />
            </div>
            <div className="flex items-center gap-1.5 rounded-lg border border-gray-200/70 bg-muted/30 p-1">
              <span className="hidden px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:inline">
                As of
              </span>
              <Input
                type="date"
                value={asOf}
                onChange={(e) => setAsOf(e.target.value)}
                className="h-9 w-35 border-0 bg-card text-sm shadow-none focus:border-primary/40 focus:ring-1 focus:ring-primary/30"
                aria-label="Posisi per"
                title="Posisi neraca per tanggal"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isFetching}
              onClick={() => refetch()}
              className="h-11 rounded-lg border-gray-200/80 px-3"
            >
              <ArrowPathIcon
                className={cn("h-4 w-4", isFetching && "animate-spin")}
              />
              <span className="ml-1.5 hidden sm:inline">Refresh</span>
            </Button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <DashboardSkeleton />
      ) : isError ? (
        <div className="rounded-xl border border-gray-200/70 bg-card py-14 text-center text-sm text-destructive shadow-sm">
          {error instanceof Error ? error.message : "Gagal memuat dashboard"}
        </div>
      ) : !data ? (
        <div className="rounded-xl border border-gray-200/70 bg-card py-14 text-center text-sm text-muted-foreground shadow-sm">
          Data tidak tersedia untuk company Anda.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Total Assets"
              value={data.kpis.total_assets}
              hint={`Posisi per ${data.as_of}`}
              href={REPORT_ROUTES.balanceSheet}
              icon={ScaleIcon}
            />
            <KpiCard
              label="Liabilities + Equity"
              value={data.kpis.total_liabilities + data.kpis.total_equity}
              hint="Harus seimbang dengan assets"
              href={REPORT_ROUTES.balanceSheet}
              icon={ScaleIcon}
            />
            <KpiCard
              label="Net Income"
              value={data.kpis.net_income}
              hint={`${data.date_from} → ${data.date_to}`}
              href={REPORT_ROUTES.incomeStatement}
              icon={DocumentChartBarIcon}
              tone={netTone}
            />
            <KpiCard
              label="Cash & Bank"
              value={data.kpis.cash_balance}
              hint={
                data.kpis.cash_change >= 0
                  ? `Δ +${formatLedgerAmount(data.kpis.cash_change)}`
                  : `Δ ${formatLedgerAmount(data.kpis.cash_change)}`
              }
              href={REPORT_ROUTES.cashFlow}
              icon={BanknotesIcon}
              tone={data.kpis.cash_change >= 0 ? "positive" : "negative"}
            />
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatChip
              label="Trial Balance Diff"
              value={formatLedgerAmount(data.kpis.trial_balance_diff)}
              ok={tbBalanced}
            />
            <StatChip label="JE Posted" value={data.kpis.posted_entries_ytd} />
            <StatChip
              label="JE Draft"
              value={data.kpis.draft_entries}
              ok={data.kpis.draft_entries === 0 ? true : false}
            />
            <StatChip
              label="Cash Opening"
              value={formatLedgerAmount(data.kpis.cash_opening)}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel
              title="Struktur Neraca"
              description="Komposisi Assets / Liabilities / Equity"
              action={
                <Link
                  href={REPORT_ROUTES.balanceSheet}
                  className="text-xs font-medium text-brand-text hover:underline"
                >
                  Detail
                </Link>
              }
            >
              <BalanceCompositionChart rows={data.balance_composition} />
            </Panel>

            <Panel
              title="Laba Rugi"
              description="Breakdown pendapatan & beban periode"
              action={
                <Link
                  href={REPORT_ROUTES.incomeStatement}
                  className="text-xs font-medium text-brand-text hover:underline"
                >
                  Detail
                </Link>
              }
            >
              <PnlBreakdownChart rows={data.pnl_breakdown} />
            </Panel>

            <Panel
              title="Tren Periode"
              description="Revenue vs Expense vs Net per bulan"
            >
              <MonthlyTrendChart rows={data.monthly_trend} />
            </Panel>

            <Panel
              title="Cash Flow"
              description="Operating · Investing · Financing"
              action={
                <Link
                  href={REPORT_ROUTES.cashFlow}
                  className="text-xs font-medium text-brand-text hover:underline"
                >
                  Detail
                </Link>
              }
            >
              <CashFlowChart rows={data.cash_flow_breakdown} />
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-5">
            <Panel
              className="lg:col-span-3"
              title="Top Beban"
              description="Akun expense / COGS terbesar di periode"
            >
              <TopExpenseChart rows={data.top_expense_accounts} />
            </Panel>

            <Panel
              className="lg:col-span-2"
              title="Laporan"
              description="Akses cepat report detail"
            >
              <div className="space-y-2">
                {QUICK_LINKS.map((link) => {
                  const Icon = link.icon;
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      className="flex items-center gap-3 rounded-xl border border-gray-200/70 px-3 py-3 transition-colors hover:border-primary/25 hover:bg-muted/40"
                    >
                      <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-brand-text">
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-foreground">
                          {link.title}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {link.description}
                        </span>
                      </span>
                      <ArrowRightIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </Link>
                  );
                })}
              </div>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

/** @deprecated use AccountingDashboardPage */
export { AccountingDashboardPage as ReportsHubPage };
