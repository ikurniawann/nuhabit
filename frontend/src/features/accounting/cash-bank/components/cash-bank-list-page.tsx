"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { BanknotesIcon } from "@heroicons/react/24/outline";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { useCashBankAccounts } from "../queries";
import { CASH_BANK_ROUTES } from "../routes";
import { formatLedgerAmount } from "@/lib/accounting/format";


export function CashBankListPage() {
  const router = useRouter();
  const { data, isLoading } = useCashBankAccounts();
  const rows = useMemo(() => data ?? [], [data]);
  const totalBalance = useMemo(
    () => rows.reduce((s, r) => s + r.balance, 0),
    [rows]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Cash & Bank</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Posisi kas & bank dari jurnal POSTED — {rows.length} akun
          </p>
        </div>
        <div className="rounded-lg border border-gray-200/70 bg-card px-4 py-2 text-sm">
          <span className="text-muted-foreground">Total saldo: </span>
          <span className="font-semibold tabular-nums text-foreground">
            {formatLedgerAmount(totalBalance)}
          </span>
        </div>
      </div>

      <PurchasingListSection
        icon={BanknotesIcon}
        title="Akun Kas & Bank"
        description="Hanya akun yang ditandai Kas/Bank di Chart of Accounts."
      >
        {isLoading ? (
          <div className="py-14 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand-text" />
            <p className="mt-2 text-sm text-muted-foreground">
              Memuat Cash & Bank...
            </p>
          </div>
        ) : rows.length === 0 ? (
          <div className="py-14 text-center">
            <p className="text-muted-foreground">
              Belum ada akun Kas/Bank. Tandai di Chart of Accounts.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto px-4">
            <table className="w-full min-w-180 text-sm">
              <thead>
                <tr className="border-b border-gray-200/70 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-3">Kode</th>
                  <th className="px-3 py-3">Nama</th>
                  <th className="px-3 py-3">Type</th>
                  <th className="px-3 py-3 text-right">Mutasi</th>
                  <th className="px-3 py-3 text-right">Saldo</th>
                  <th className="px-3 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-gray-200/70 last:border-0 hover:bg-muted/30"
                  >
                    <td className="px-3 py-3 font-mono text-xs text-muted-foreground">
                      {row.code_display || row.code}
                    </td>
                    <td className="px-3 py-3 font-medium text-foreground">
                      {row.name}
                    </td>
                    <td className="px-3 py-3">
                      <Badge
                        variant="outline"
                        className="border-gray-200/80 font-normal"
                      >
                        {row.account_type_code || "—"}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                      {row.movement_count}
                    </td>
                    <td className="px-3 py-3 text-right font-medium tabular-nums text-foreground">
                      {formatLedgerAmount(row.balance)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          router.push(CASH_BANK_ROUTES.ledger(row.id))
                        }
                        className="h-8 rounded-lg border-gray-200/80"
                      >
                        Ledger
                      </Button>
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
