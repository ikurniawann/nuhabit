"use client";

import { Loader2 } from "lucide-react";
import type { ReportAccountBalance } from "../types";
import { formatLedgerAmount } from "@/lib/accounting/format";

export function AccountBalanceTable({
  rows,
  emptyMessage = "Tidak ada akun",
  showType = false,
}: {
  rows: ReportAccountBalance[];
  emptyMessage?: string;
  showType?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-180 text-sm">
        <thead>
          <tr className="border-b border-gray-200/70 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-3">Kode</th>
            <th className="px-3 py-3">Nama</th>
            {showType ? <th className="px-3 py-3">Type</th> : null}
            <th className="px-3 py-3 text-right">Debit</th>
            <th className="px-3 py-3 text-right">Credit</th>
            <th className="px-3 py-3 text-right">Saldo</th>
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
              {showType ? (
                <td className="px-3 py-3 text-xs text-muted-foreground">
                  {row.account_type_code}
                </td>
              ) : null}
              <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                {formatLedgerAmount(row.debit)}
              </td>
              <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                {formatLedgerAmount(row.credit)}
              </td>
              <td className="px-3 py-3 text-right font-medium tabular-nums text-foreground">
                {formatLedgerAmount(row.balance)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SectionTitle({
  title,
  total,
}: {
  title: string;
  total?: number;
}) {
  return (
    <div className="flex items-center justify-between border-b border-gray-200/70 pb-2">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {typeof total === "number" ? (
        <span className="text-sm font-semibold tabular-nums text-foreground">
          {formatLedgerAmount(total)}
        </span>
      ) : null}
    </div>
  );
}

export function SummaryRow({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: number;
  emphasize?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between px-3 py-2 text-sm ${
        emphasize
          ? "rounded-lg bg-muted/50 font-semibold text-foreground"
          : "text-muted-foreground"
      }`}
    >
      <span>{label}</span>
      <span className="tabular-nums text-foreground">
        {formatLedgerAmount(value)}
      </span>
    </div>
  );
}

export function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="py-14 text-center">
      <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand-text" />
      <p className="mt-2 text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

export function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="py-14 text-center text-sm text-destructive">{message}</div>
  );
}
