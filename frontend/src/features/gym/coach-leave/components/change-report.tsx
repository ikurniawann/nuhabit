"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlarmClock, CalendarClock, UserRoundCog } from "lucide-react";
import { Field, TableNote } from "@/features/crm/engagement/components/shared";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatCard } from "@/components/ui/stat-card";
import { formatNumber } from "@/lib/format";
import { addDays } from "@/lib/dates";
import { localDay } from "@/lib/timezone";
import { waktu } from "@/features/gym/scheduling/api";
import { CHANGE_LABEL, COACH_LEAVE_KEYS, coachLeaveApi } from "../api";

/**
 * Kelas yang dipindah, diganti coach-nya, atau dibatalkan studio. Perubahan
 * yang dikabarkan kurang dari batas jam aturan gym (changeNoticeMinHours)
 * ditandai terlambat.
 */
export function ChangeReport() {
  const today = localDay(new Date());
  const [range, setRange] = useState({ from: addDays(today, -30), to: today });
  const report = useQuery({
    queryKey: COACH_LEAVE_KEYS.changes(range.from, range.to, ""),
    queryFn: () => coachLeaveApi.changes(range.from, range.to),
  });
  const r = report.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Field label="Dari">
          <Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        </Field>
        <Field label="Sampai">
          <Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <StatCard label="Perubahan" value={formatNumber(r?.total ?? 0)} unit="kelas" icon={<CalendarClock />} tone="ink" />
        <StatCard label="Coach diganti" value={formatNumber(r?.by_kind.coach_changed ?? 0)} unit="kelas" icon={<UserRoundCog />} />
        <StatCard
          label="Dikabarkan terlambat"
          value={formatNumber(r?.late ?? 0)}
          unit="kelas"
          icon={<AlarmClock />}
          tone={r?.late ? "info" : "default"}
        />
      </div>
      <Card className="py-0">
        {report.isLoading ? (
          <TableNote>Memuat laporan…</TableNote>
        ) : report.error ? (
          <TableNote tone="danger">{report.error.message}</TableNote>
        ) : !r || r.changes.length === 0 ? (
          <TableNote>Tidak ada perubahan jadwal di rentang ini.</TableNote>
        ) : (
          <ul className="divide-y divide-border">
            {r.changes.map((c) => (
              <li key={c.session_id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <span className="min-w-0 text-sm">
                  <span className="font-medium">{c.class_name}</span> · {waktu(c.starts_at, c.timezone)}
                  <span className="block text-xs text-muted-foreground">
                    {CHANGE_LABEL[c.change_kind] ?? c.change_kind} {waktu(c.changed_at, c.timezone)}, {formatNumber(Math.max(0, Math.round(c.hours_before_start)))} jam
                    sebelum mulai · {formatNumber(c.booked)} member
                    {c.coach_name && ` · coach ${c.coach_name}`}
                    {c.original_coach_name && ` (semula ${c.original_coach_name})`}
                    {c.branch_name && ` · ${c.branch_name}`}
                  </span>
                </span>
                {c.change_notice_late ? <Badge variant="destructive">Terlambat</Badge> : <Badge variant="success">Tepat waktu</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
