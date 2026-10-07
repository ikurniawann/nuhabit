"use client";

import { NumericInput } from "@/components/ui/numeric-input";
import type { BalanceRow, ViewMode } from "../balance-rows";

export function BeginningBalanceTable({
  rows: visibleRows,
  viewMode,
  readOnly,
  onAmountChange: updateAmount,
}: {
  rows: BalanceRow[];
  viewMode: ViewMode;
  readOnly: boolean;
  onAmountChange: (
    accountId: string,
    side: "debit" | "credit",
    value: number,
  ) => void;
}) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[860px] text-sm">
        <thead>
          <tr className="border-b border-gray-200/70 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-3">Kode</th>
            <th className="px-3 py-3">Nama akun</th>
            <th className="px-3 py-3">Tipe</th>
            <th className="px-3 py-3 text-right">Debit</th>
            <th className="px-3 py-3 text-right">Credit</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.length === 0 ? (
            <tr>
              <td
                colSpan={5}
                className="px-3 py-10 text-center text-muted-foreground"
              >
                {viewMode === "cash_bank"
                  ? "Tidak ada akun Kas/Bank (is_cash_bank). Tandai dulu di Chart of Accounts."
                  : "Tidak ada akun COA yang cocok"}
              </td>
            </tr>
          ) : (
            visibleRows.map((row) => (
              <tr
                key={row.account_id}
                className="border-b border-gray-200/70 last:border-0 hover:bg-muted/30"
              >
                <td className="px-3 py-2 font-medium tabular-nums text-foreground">
                  {row.code}
                  {row.source === "PRIOR_BS" ||
                  row.source === "RETAINED_EARNINGS" ? (
                    <span className="ml-2 text-[10px] font-normal uppercase text-muted-foreground">
                      {row.source === "RETAINED_EARNINGS" ? "RE" : "suggest"}
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-foreground">{row.name}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {row.account_type_code}
                </td>
                <td className="px-3 py-2">
                  <NumericInput
                    value={row.debit || null}
                    onValueChange={(v) =>
                      updateAmount(row.account_id, "debit", v)
                    }
                    decimalScale={2}
                    disabled={readOnly}
                    placeholder="0"
                    className="h-9 border-gray-200/80 text-right focus:border-primary/40 focus:ring-1 focus:ring-primary/30"
                  />
                </td>
                <td className="px-3 py-2">
                  <NumericInput
                    value={row.credit || null}
                    onValueChange={(v) =>
                      updateAmount(row.account_id, "credit", v)
                    }
                    decimalScale={2}
                    disabled={readOnly}
                    placeholder="0"
                    className="h-9 border-gray-200/80 text-right focus:border-primary/40 focus:ring-1 focus:ring-primary/30"
                  />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
