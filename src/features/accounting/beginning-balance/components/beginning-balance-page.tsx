"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FormPageBody,
  FormPageFooter,
  FormPageHeader,
  FormPageLayout,
  FormPageLoading,
} from "@/components/layout/form-page-layout";
import { useCoaList } from "@/features/accounting/chart-of-accounts/queries";
import type { CoaAccountItem } from "@/features/accounting/chart-of-accounts/types";
import type { BeginningBalanceSuggestion } from "@/lib/accounting/types";
import {
  balanceTotals,
  buildRows,
  buildSaveLines,
  filterRows,
  setRowAmount,
  type ViewMode,
} from "../balance-rows";
import { BeginningBalanceTable } from "./beginning-balance-table";
import { BEGINNING_BALANCE_ROUTES } from "../routes";
import { useBeginningBalance } from "../queries";
import { useSaveBeginningBalance } from "../mutations";
import { formatLedgerAmount } from "@/lib/accounting/format";

export function BeginningBalancePage({
  fiscalYearId,
}: {
  fiscalYearId: string;
}) {
  const router = useRouter();
  const balanceQuery = useBeginningBalance(fiscalYearId);
  const { data: coaData, isLoading: coaLoading } = useCoaList({
    is_postable: "true",
    is_active: "true",
  });
  const data = balanceQuery.data;

  if (balanceQuery.isLoading || coaLoading) return <FormPageLoading />;

  if (balanceQuery.isError || !data) {
    return (
      <FormPageLayout>
        <FormPageHeader
          title="Beginning balance tidak tersedia"
          description="Fiscal year mungkin tidak ditemukan."
          onBack={() => router.push(BEGINNING_BALANCE_ROUTES.list)}
        />
      </FormPageLayout>
    );
  }

  // Remount editor saat data saldo awal dimuat ulang (mis. setelah simpan draft).
  return (
    <BeginningBalanceEditor
      key={balanceQuery.dataUpdatedAt}
      fiscalYearId={fiscalYearId}
      data={data}
      accounts={coaData ?? []}
    />
  );
}

function BeginningBalanceEditor({
  fiscalYearId,
  data,
  accounts,
}: {
  fiscalYearId: string;
  data: BeginningBalanceSuggestion;
  accounts: CoaAccountItem[];
}) {
  const router = useRouter();
  const saveMutation = useSaveBeginningBalance(fiscalYearId);
  const [rows, setRows] = useState(() => buildRows(accounts, data.lines));
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("cash_bank");

  const visibleRows = useMemo(
    () => filterRows(rows, viewMode, searchQuery),
    [rows, searchQuery, viewMode],
  );
  const cashTotals = useMemo(
    () => balanceTotals(rows.filter((r) => r.is_cash_bank)),
    [rows],
  );
  const allTotals = useMemo(() => balanceTotals(rows), [rows]);

  const totals = viewMode === "cash_bank" ? cashTotals : allTotals;
  const autoBalanceSide =
    viewMode === "cash_bank" && cashTotals.diff !== 0
      ? cashTotals.diff > 0
        ? ("CREDIT" as const)
        : ("DEBIT" as const)
      : null;
  const autoBalanceAmount =
    viewMode === "cash_bank" ? Math.abs(cashTotals.diff) : 0;

  const readOnly = !data.can_edit;
  const isSaving = saveMutation.isPending;

  function updateAmount(
    accountId: string,
    side: "debit" | "credit",
    value: number,
  ) {
    setRows((prev) => setRowAmount(prev, accountId, side, value));
  }

  async function handleSave(post: boolean) {
    if (isSaving || readOnly) return;
    const retainedEarningsId = data.retained_earnings_account?.id ?? null;
    const result = buildSaveLines(rows, viewMode, retainedEarningsId);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }

    try {
      const res = await saveMutation.mutateAsync({
        lines: result.lines,
        post,
        retained_earnings_account_id: retainedEarningsId,
      });
      toast.success(res.message || "Berhasil disimpan");
      if (post) router.push(BEGINNING_BALANCE_ROUTES.list);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan");
    }
  }

  return (
    <FormPageLayout>
      <FormPageHeader
        title={`Beginning Balance — ${data.fiscal_year_code}`}
        description={`${data.fiscal_year_name} · mulai ${data.start_date}${
          data.period_name ? ` · period ${data.period_name}` : ""
        }`}
        onBack={() => router.push(BEGINNING_BALANCE_ROUTES.list)}
      />

      {data.message ? (
        <div
          className={
            data.is_first_year
              ? "mb-4 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-foreground"
              : "mb-4 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground"
          }
        >
          {data.is_first_year ? (
            <p className="font-medium">Fiscal year pertama</p>
          ) : null}
          <p
            className={
              data.is_first_year ? "mt-1 text-muted-foreground" : undefined
            }
          >
            {data.message}
          </p>
          {data.prior_fiscal_year ? (
            <span className="mt-1 block text-xs text-muted-foreground">
              Sumber: {data.prior_fiscal_year.code} (akhir{" "}
              {data.prior_fiscal_year.end_date})
              {data.prior_fiscal_year.is_fully_closed
                ? " · fully closed"
                : " · belum fully closed"}
            </span>
          ) : null}
          {data.retained_earnings_account ? (
            <span className="mt-1 block text-xs text-muted-foreground">
              Retained Earnings: {data.retained_earnings_account.code} —{" "}
              {data.retained_earnings_account.name}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-6">
        <FormPageBody>
          <section className="rounded-xl border border-gray-200/70 bg-card p-5 shadow-sm">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">
                    Chart of Accounts — isi saldo
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {viewMode === "cash_bank"
                      ? "Mode Kas & Bank: isi saldo kas/bank saja. Selisih otomatis di-balance ke Laba Ditahan / Retained Earnings."
                      : "Mode semua neraca (Asset / Liability / Equity). Total Debit harus = Credit."}
                  </p>
                </div>
                <label className="relative w-full sm:w-64">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Cari kode / nama akun..."
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
              </div>

              <Tabs
                value={viewMode}
                onValueChange={(v) => setViewMode(v as ViewMode)}
              >
                <TabsList className="h-10">
                  <TabsTrigger value="cash_bank" className="px-3">
                    Kas & Bank saja
                  </TabsTrigger>
                  <TabsTrigger value="all" className="px-3">
                    Semua neraca
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {viewMode === "cash_bank" && autoBalanceAmount > 0 ? (
              <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-foreground">
                Auto-balance:{" "}
                <span className="font-medium">
                  {autoBalanceSide}{" "}
                  {data.retained_earnings_account
                    ? `${data.retained_earnings_account.code} — ${data.retained_earnings_account.name}`
                    : "Laba Ditahan (belum ditemukan di COA)"}
                </span>{" "}
                = {formatLedgerAmount(autoBalanceAmount)}
              </div>
            ) : null}

            <BeginningBalanceTable
              rows={visibleRows}
              viewMode={viewMode}
              readOnly={readOnly}
              onAmountChange={updateAmount}
            />

            <div className="mt-4 flex flex-wrap gap-4 border-t border-gray-200/70 pt-4 text-sm">
              <div className="text-muted-foreground">
                Terisi:{" "}
                <span className="font-medium text-foreground">
                  {totals.filled}
                </span>{" "}
                akun
              </div>
              <div>
                Debit:{" "}
                <span className="font-medium tabular-nums">
                  {formatLedgerAmount(totals.debit)}
                </span>
              </div>
              <div>
                Credit:{" "}
                <span className="font-medium tabular-nums">
                  {formatLedgerAmount(totals.credit)}
                </span>
              </div>
              {viewMode === "cash_bank" ? (
                <div className="text-muted-foreground">
                  Setelah auto-balance:{" "}
                  <span className="font-medium text-foreground tabular-nums">
                    {formatLedgerAmount(Math.max(totals.debit, totals.credit))}{" "}
                    /{" "}
                    {formatLedgerAmount(Math.max(totals.debit, totals.credit))}
                  </span>
                </div>
              ) : (
                <div
                  className={
                    totals.diff === 0
                      ? "text-muted-foreground"
                      : "text-destructive"
                  }
                >
                  Selisih:{" "}
                  <span className="font-medium tabular-nums">
                    {formatLedgerAmount(Math.abs(totals.diff))}
                  </span>
                </div>
              )}
            </div>
          </section>
        </FormPageBody>

        <FormPageFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(BEGINNING_BALANCE_ROUTES.list)}
            disabled={isSaving}
            className="h-10 rounded-lg border-gray-200/80"
          >
            Kembali
          </Button>
          {!readOnly ? (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={isSaving || totals.filled === 0}
                onClick={() => void handleSave(false)}
                className="h-10 gap-2 rounded-lg border-gray-200/80"
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Simpan Draft
              </Button>
              <Button
                type="button"
                disabled={
                  isSaving ||
                  totals.filled === 0 ||
                  (viewMode === "all" &&
                    (totals.filled < 2 || totals.diff !== 0)) ||
                  (viewMode === "cash_bank" &&
                    !data.retained_earnings_account &&
                    cashTotals.diff !== 0)
                }
                onClick={() => void handleSave(true)}
                className="h-10 gap-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Post Beginning Balance
              </Button>
            </>
          ) : null}
        </FormPageFooter>
      </div>
    </FormPageLayout>
  );
}
