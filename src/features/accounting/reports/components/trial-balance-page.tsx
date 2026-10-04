"use client";

import { useState } from "react";
import { TableCellsIcon } from "@heroicons/react/24/outline";
import { useTrialBalance } from "../queries";
import { AsOfFilter, ReportShell, todayStr } from "./report-shell";
import {
  AccountBalanceTable,
  ErrorBlock,
  LoadingBlock,
  SummaryRow,
} from "./report-table";
import { formatLedgerAmount } from "@/lib/accounting/format";

export function TrialBalancePage() {
  const [asOf, setAsOf] = useState(todayStr());
  const { data, isLoading, isError, error } = useTrialBalance(asOf);

  return (
    <ReportShell
      icon={TableCellsIcon}
      title="Trial Balance"
      description={`Neraca saldo per ${asOf}`}
      toolbar={<AsOfFilter value={asOf} onChange={setAsOf} />}
    >
      <div className="space-y-4 px-4 pb-4">
        {isLoading ? (
          <LoadingBlock label="Memuat Trial Balance..." />
        ) : isError ? (
          <ErrorBlock
            message={
              error instanceof Error
                ? error.message
                : "Gagal memuat Trial Balance"
            }
          />
        ) : !data ? (
          <ErrorBlock message="Data tidak tersedia untuk company Anda." />
        ) : (
          <>
            <AccountBalanceTable rows={data.rows} showType />
            <div className="space-y-1 border-t border-gray-200/70 pt-3">
              <SummaryRow label="Total Debit" value={data.total_debit} />
              <SummaryRow label="Total Credit" value={data.total_credit} />
              <SummaryRow
                label="Selisih"
                value={Math.abs(data.total_debit - data.total_credit)}
                emphasize
              />
              <p className="px-3 pt-1 text-xs text-muted-foreground">
                {data.rows.length} akun postable · termasuk saldo 0 · selisih{" "}
                {formatLedgerAmount(
                  Math.abs(data.total_debit - data.total_credit),
                )}
              </p>
            </div>
          </>
        )}
      </div>
    </ReportShell>
  );
}
