"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TableNote } from "@/features/crm/engagement/components/shared";
import { currentMonth } from "@/features/gym/incentives/api";
import { monthLabel, PAYOUT_VARIANT } from "@/features/gym/incentives/components/shared";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PAYOUT_STATUS_LABELS } from "@/lib/gym/incentive";
import { formatDate, formatDateTime, formatNumber, formatRupiah } from "@/lib/format";
import { MY_CLASSES_KEYS, myClassesApi } from "../api";

/** Insentif coach yang login: statement berjalan satu bulan dan riwayat payout. Hanya baca. */
export function MyIncentives() {
  const [month, setMonth] = useState(currentMonth);
  const query = useQuery({ queryKey: MY_CLASSES_KEYS.incentives(month), queryFn: () => myClassesApi.incentives(month) });
  const statement = query.data?.statement;
  const payouts = query.data?.payouts ?? [];

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">Honor {monthLabel(month)}</p>
            <p className="text-2xl font-semibold tabular-nums">{formatRupiah(statement?.totals.totalIdr ?? 0)}</p>
            <p className="text-xs text-muted-foreground">
              {formatNumber(statement?.totals.sessions ?? 0)} kelas selesai · {formatNumber(statement?.totals.attended ?? 0)} peserta hadir
            </p>
          </div>
          <Input
            type="month"
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
            className="w-44"
            aria-label="Bulan insentif"
          />
        </div>
        {query.isLoading ? (
          <TableNote>Menghitung insentif…</TableNote>
        ) : query.error ? (
          <TableNote tone="danger">{query.error.message}</TableNote>
        ) : !statement || statement.lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada kelas selesai di bulan ini.</p>
        ) : (
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {statement.lines.map((line) => (
              <li key={line.sessionId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{line.classTypeName}</span>
                  <span className="block text-xs text-muted-foreground">
                    {formatDateTime(line.startsAt)} · {line.attended}/{line.capacity} hadir
                    {line.noShows > 0 && ` · ${line.noShows} tidak hadir`}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">{formatRupiah(line.totalIdr)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          Honor dihitung dari kelas yang sudah ditutup. Setelah payout dibayar, insentif masuk slip gaji pada periode payroll yang
          tertulis di bawah.
        </p>
      </Card>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Payout</h2>
        {payouts.length === 0 ? (
          <Card className="py-0">
            <TableNote>Belum ada payout.</TableNote>
          </Card>
        ) : (
          <Card className="divide-y divide-border py-0">
            {payouts.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="min-w-0">
                  <span className="block font-medium">{monthLabel(p.month)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {formatNumber(p.sessions)} kelas
                    {p.payroll_period && ` · masuk payroll ${monthLabel(p.payroll_period)}`}
                    {p.paid_at && ` · dibayar ${formatDate(p.paid_at)}`}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-sm font-semibold tabular-nums">{formatRupiah(p.total_idr)}</span>
                  <Badge variant={PAYOUT_VARIANT[p.status]}>{PAYOUT_STATUS_LABELS[p.status]}</Badge>
                </span>
              </div>
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}
