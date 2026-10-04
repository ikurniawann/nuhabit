"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { BanknotesIcon } from "@heroicons/react/24/outline";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { JOURNAL_ENTRY_ROUTES } from "@/features/accounting/journal-entries/routes";
import { useCashBankLedger } from "../queries";
import { CASH_BANK_ROUTES } from "../routes";
import { formatLedgerAmount } from "@/lib/accounting/format";


export function CashBankLedgerPage() {
  const router = useRouter();
  const params = useParams<{ accountId: string }>();
  const accountId = params?.accountId ?? null;
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const filters = useMemo(
    () => ({
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    }),
    [dateFrom, dateTo]
  );

  const { data, isLoading, isError, error } = useCashBankLedger(
    accountId,
    filters
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {data
              ? `${data.account.code_display} — ${data.account.name}`
              : "Cash & Bank Ledger"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Mutasi jurnal POSTED dengan saldo berjalan
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push(CASH_BANK_ROUTES.list)}
          className="h-10 rounded-lg border-gray-200/80"
        >
          Kembali
        </Button>
      </div>

      <PurchasingListSection
        icon={BanknotesIcon}
        title="Ledger"
        description="Filter tanggal opsional. Opening = saldo sebelum tanggal dari."
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-10 w-37.5 bg-card text-sm focus:border-primary/40 focus:ring-1 focus:ring-primary/30"
              aria-label="Dari tanggal"
            />
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-10 w-37.5 bg-card text-sm focus:border-primary/40 focus:ring-1 focus:ring-primary/30"
              aria-label="Sampai tanggal"
            />
          </div>
        }
      >
        {isLoading ? (
          <div className="py-14 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand-text" />
            <p className="mt-2 text-sm text-muted-foreground">Memuat ledger...</p>
          </div>
        ) : isError ? (
          <div className="py-14 text-center text-sm text-destructive">
            {error instanceof Error
              ? error.message
              : "Gagal memuat ledger"}
          </div>
        ) : !data ? (
          <div className="py-14 text-center text-muted-foreground">
            Akun tidak ditemukan
          </div>
        ) : (
          <div className="space-y-4 px-4 pb-4">
            <div className="flex flex-wrap gap-4 border-b border-gray-200/70 pb-3 text-sm">
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
              <Badge variant="outline" className="border-gray-200/80">
                Normal {data.account.normal_balance}
              </Badge>
            </div>

            {data.lines.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground">
                Tidak ada mutasi pada periode ini
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
                    <tr className="border-b border-gray-200/70 bg-muted/20 text-muted-foreground">
                      <td className="px-2 py-2" colSpan={3}>
                        Opening balance
                      </td>
                      <td className="px-2 py-2 text-right">—</td>
                      <td className="px-2 py-2 text-right">—</td>
                      <td className="px-2 py-2 text-right tabular-nums font-medium text-foreground">
                        {formatLedgerAmount(data.opening_balance)}
                      </td>
                      <td className="px-2 py-2" />
                    </tr>
                    {data.lines.map((line) => (
                      <tr
                        key={line.line_id}
                        className="border-b border-gray-200/70 last:border-0 hover:bg-muted/30"
                      >
                        <td className="px-2 py-2 tabular-nums">
                          {line.entry_date}
                        </td>
                        <td className="px-2 py-2">
                          <span className="font-medium">{line.entry_no}</span>
                          {line.entry_type === "OPENING" ? (
                            <Badge
                              variant="outline"
                              className="ml-1 border-gray-200/80 text-[10px]"
                            >
                              OB
                            </Badge>
                          ) : null}
                        </td>
                        <td className="max-w-60 truncate px-2 py-2">
                          {line.memo || line.description || "—"}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {line.debit > 0 ? formatLedgerAmount(line.debit) : ""}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {line.credit > 0 ? formatLedgerAmount(line.credit) : ""}
                        </td>
                        <td className="px-2 py-2 text-right font-medium tabular-nums">
                          {formatLedgerAmount(line.running_balance)}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              router.push(
                                JOURNAL_ENTRY_ROUTES.edit(line.entry_id)
                              )
                            }
                            className="h-8 text-muted-foreground"
                          >
                            Lihat
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </PurchasingListSection>
    </div>
  );
}
