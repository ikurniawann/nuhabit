"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DocumentTextIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { filterComboboxClassName } from "@/components/layout/form-field";
import { JOURNAL_ENTRY_ROUTES } from "@/features/accounting/journal-entries/routes";
import { useGeneralLedger, useGeneralLedgerAccounts } from "../queries";
import {
  PeriodFilter,
  ReportShell,
  todayStr,
  yearStartStr,
} from "./report-shell";
import { ErrorBlock, LoadingBlock } from "./report-table";
import { formatLedgerAmount } from "@/lib/accounting/format";

export function GeneralLedgerPage() {
  const router = useRouter();
  const [asOf] = useState(todayStr());
  const [accountId, setAccountId] = useState<string>("");
  const [dateFrom, setDateFrom] = useState(yearStartStr());
  const [dateTo, setDateTo] = useState(todayStr());

  const accountsQuery = useGeneralLedgerAccounts(asOf);
  const ledgerQuery = useGeneralLedger(accountId || null, dateFrom, dateTo);

  const accountOptions = useMemo(
    () =>
      (accountsQuery.data ?? []).map((a) => ({
        value: a.id,
        label: `${a.code_display || a.code} — ${a.name}`,
        description: `${a.account_type_code} · saldo ${formatLedgerAmount(a.balance)}`,
      })),
    [accountsQuery.data],
  );

  const data = ledgerQuery.data;

  return (
    <ReportShell
      icon={DocumentTextIcon}
      title="General Ledger"
      description="Buku besar per akun postable (termasuk saldo 0)"
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <Combobox
            options={accountOptions}
            value={accountId}
            onChange={setAccountId}
            placeholder="Pilih akun..."
            searchPlaceholder="Cari kode / nama..."
            allowClear
            className={`${filterComboboxClassName} h-10 min-w-[260px] flex-1 bg-card`}
            contentClassName="min-w-[360px]"
          />
          <PeriodFilter
            dateFrom={dateFrom}
            dateTo={dateTo}
            onFrom={setDateFrom}
            onTo={setDateTo}
          />
        </div>
      }
    >
      <div className="space-y-4 px-4 pb-4">
        {!accountId ? (
          <div className="py-14 text-center text-sm text-muted-foreground">
            Pilih akun untuk menampilkan buku besar.
            {accountsQuery.data ? (
              <span className="mt-1 block">
                {accountsQuery.data.length} akun postable tersedia.
              </span>
            ) : null}
          </div>
        ) : ledgerQuery.isLoading || accountsQuery.isLoading ? (
          <LoadingBlock label="Memuat General Ledger..." />
        ) : ledgerQuery.isError ? (
          <ErrorBlock
            message={
              ledgerQuery.error instanceof Error
                ? ledgerQuery.error.message
                : "Gagal memuat General Ledger"
            }
          />
        ) : !data ? (
          <ErrorBlock message="Akun tidak ditemukan." />
        ) : (
          <>
            <div className="flex flex-wrap gap-4 border-b border-gray-200/70 pb-3 text-sm">
              <div className="font-medium text-foreground">
                {data.account.code_display} — {data.account.name}
              </div>
              <div>
                Opening:{" "}
                <span className="font-medium tabular-nums">
                  {formatLedgerAmount(data.opening_balance)}
                </span>
              </div>
              <div>
                Debit:{" "}
                <span className="font-medium tabular-nums">
                  {formatLedgerAmount(data.total_debit)}
                </span>
              </div>
              <div>
                Credit:{" "}
                <span className="font-medium tabular-nums">
                  {formatLedgerAmount(data.total_credit)}
                </span>
              </div>
              <div>
                Closing:{" "}
                <span className="font-medium tabular-nums">
                  {formatLedgerAmount(data.closing_balance)}
                </span>
              </div>
            </div>

            {data.lines.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                Tidak ada mutasi pada periode ini. Saldo tetap{" "}
                {formatLedgerAmount(data.closing_balance)}.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-220 text-sm">
                  <thead>
                    <tr className="border-b border-gray-200/70 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      <th className="px-2 py-2">Tanggal</th>
                      <th className="px-2 py-2">No Jurnal</th>
                      <th className="px-2 py-2">Deskripsi / Memo</th>
                      <th className="px-2 py-2 text-right">Debit</th>
                      <th className="px-2 py-2 text-right">Credit</th>
                      <th className="px-2 py-2 text-right">Saldo</th>
                      <th className="px-2 py-2 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lines.map((line) => (
                      <tr
                        key={line.line_id}
                        className="border-b border-gray-200/70 last:border-0 hover:bg-muted/30"
                      >
                        <td className="px-2 py-2 tabular-nums text-muted-foreground">
                          {line.entry_date}
                        </td>
                        <td className="px-2 py-2 font-mono text-xs">
                          {line.entry_no}
                        </td>
                        <td className="px-2 py-2 text-foreground">
                          {line.memo || line.description || "—"}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {line.debit ? formatLedgerAmount(line.debit) : "—"}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {line.credit ? formatLedgerAmount(line.credit) : "—"}
                        </td>
                        <td className="px-2 py-2 text-right font-medium tabular-nums">
                          {formatLedgerAmount(line.running_balance)}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 rounded-lg border-gray-200/80"
                            onClick={() =>
                              router.push(
                                JOURNAL_ENTRY_ROUTES.edit(line.entry_id),
                              )
                            }
                          >
                            JE
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </ReportShell>
  );
}
