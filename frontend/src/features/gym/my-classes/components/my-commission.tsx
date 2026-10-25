"use client";

import { useQuery } from "@tanstack/react-query";
import { monthLabel } from "@/features/gym/incentives/components/shared";
import {
  COMMISSION_STATUS_LABELS,
  COMMISSION_STATUS_VARIANT,
  commissionApi,
  formatPercent,
  incidentLabel,
  METHOD_LABELS,
  ROLE_LABELS,
} from "@/features/gym/incentives/commission";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatNumber, formatRupiah } from "@/lib/format";

/** Bagi hasil coach yang login: porsinya di tiap cabang bulan ini dan riwayatnya. Hanya baca. */
export function MyCommission({ month }: { month: string }) {
  const query = useQuery({ queryKey: ["gym", "my-classes", "commission", month], queryFn: () => commissionApi.mine(month) });
  const lines = query.data?.month ?? [];
  const history = (query.data?.history ?? []).filter((h) => h.periodMonth !== month);
  if (query.isLoading || query.error || (lines.length === 0 && history.length === 0)) return null;

  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">Bagi hasil {monthLabel(month)}</h2>
      {lines.length === 0 ? (
        <Card className="p-4 text-sm text-muted-foreground">Belum ada bagi hasil untukmu di bulan ini.</Card>
      ) : (
        <Card className="divide-y divide-border py-0">
          {lines.map((l) => (
            <div key={l.branchId} className="space-y-1 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block font-medium">{l.branchName}</span>
                  <span className="block text-xs text-muted-foreground">
                    {ROLE_LABELS[l.role]} · porsi {formatPercent(l.sharePercent)} dari pool {formatRupiah(l.totalPoolIdr)} ·{" "}
                    {formatNumber(l.classSessions)} kelas{l.ptSessions > 0 && ` + ${formatNumber(l.ptSessions)} PT`}
                    {l.attributionPercent < 100 && ` · ${formatPercent(l.attributionPercent)} sesimu di sini`}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-sm font-semibold tabular-nums">{formatRupiah(l.amountIdr)}</span>
                  <Badge variant={l.status === "paid" ? "success" : COMMISSION_STATUS_VARIANT[l.statementStatus]}>
                    {l.status === "paid" ? "Dibayar" : COMMISSION_STATUS_LABELS[l.statementStatus]}
                  </Badge>
                </span>
              </div>
              {l.deductionIdr > 0 && (
                <p className="text-xs text-danger">
                  Potongan {formatRupiah(l.deductionIdr)} ({formatPercent(l.deductionPercent)}):{" "}
                  {l.incidents.map((i) => `${incidentLabel(i.kind)} ${i.occurredOn}`).join(", ")}
                </p>
              )}
            </div>
          ))}
        </Card>
      )}
      {history.length > 0 && (
        <Card className="divide-y divide-border py-0">
          {history.map((h) => (
            <div key={h.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="min-w-0">
                <span className="block font-medium">
                  {monthLabel(h.periodMonth)} · {h.branchName}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {h.paymentMethod ? METHOD_LABELS[h.paymentMethod] : COMMISSION_STATUS_LABELS[h.statementStatus]}
                  {h.payrollPeriod && ` ${monthLabel(h.payrollPeriod)}`}
                </span>
              </span>
              <span className="shrink-0 text-sm font-semibold tabular-nums">{formatRupiah(h.amountIdr)}</span>
            </div>
          ))}
        </Card>
      )}
    </section>
  );
}
