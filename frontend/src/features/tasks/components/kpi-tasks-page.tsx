"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SELECT } from "@/features/gym/shared";
import { formatNumber } from "@/lib/format";
import { MONTH_NAMES_ID } from "@/lib/hris/month-label";
import { cn } from "@/lib/utils";
import { ratePercent } from "../grouping";
import { useKpiTasks, useTaskMeta } from "../queries";
import { TaskDetailSheet } from "./task-detail-sheet";
import { TaskRow } from "./task-row";

function monthOptions(today: string): string[] {
  const [y, m] = today.split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTH_NAMES_ID[m - 1]} ${y}`;
};

/**
 * KPI & Tugas: per indikator departemen, kemunculan task yang terkait
 * bulan ini dan tingkat penyelesaiannya (disetujui ÷ jatuh tempo).
 * Kontribusi tercatat tampil sebagai konteks; perhitungan snapshot KPI
 * tidak berubah.
 */
export function KpiTasksPage() {
  const params = useSearchParams();
  const meta = useTaskMeta();
  const [chosenDepartment, setDepartment] = useState(params.get("department_id") ?? "");
  const [chosenMonth, setMonth] = useState(params.get("month") ?? "");
  const [openId, setOpenId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(params.get("indicator"));
  const departments = meta.data?.departments ?? [];
  const me = meta.data?.me;
  const department = chosenDepartment || me?.department_id || departments[0]?.id || "";
  const month = chosenMonth || meta.data?.today.slice(0, 7) || "";

  const view = useKpiTasks({ department_id: department || undefined, month: month || undefined }, !!department && !!month);
  const rows = useMemo(() => view.data?.indicators ?? [], [view.data]);
  const months = meta.data ? monthOptions(meta.data.today) : [];

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Tugas"
        title="KPI & Tugas"
        description="Untuk setiap indikator departemen: task yang terkait periode ini dan tingkat penyelesaiannya."
        actions={
          <Link href="/dashboard/tasks" className="text-sm text-brand-text underline-offset-4 hover:underline">
            Tugas saya
          </Link>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Departemen</span>
          <select className={cn(SELECT, "w-auto min-w-48")} value={department} onChange={(e) => setDepartment(e.target.value)}>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Bulan</span>
          <select className={cn(SELECT, "w-auto")} value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <Card className="py-0">
        {view.isLoading || meta.isLoading ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">Memuat…</p>
        ) : view.error ? (
          <p className="px-5 py-10 text-center text-sm text-danger">{view.error.message}</p>
        ) : rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">
            Departemen ini belum punya indikator KPI atau task terkait pada bulan ini.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Indikator</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Bobot</TableHead>
                <TableHead className="text-right">Disetujui</TableHead>
                <TableHead className="w-44">Penyelesaian</TableHead>
                <TableHead className="hidden text-right md:table-cell">Kontribusi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const open = expanded === row.indicator_id;
                return (
                  <TableRow key={row.indicator_id} className="align-top">
                    <TableCell className="whitespace-normal">
                      <button
                        type="button"
                        onClick={() => setExpanded(open ? null : row.indicator_id)}
                        aria-expanded={open}
                        className="text-left font-medium text-foreground underline-offset-4 hover:underline"
                      >
                        {row.name}
                      </button>
                      <p className="text-xs text-muted-foreground">
                        {row.code}
                        {row.unit ? ` · ${row.unit}` : ""}
                        {row.waiting_review > 0 && ` · ${row.waiting_review} tunggu review`}
                        {row.overdue > 0 && <span className="text-danger"> · {row.overdue} terlambat</span>}
                      </p>
                      {open && (
                        <ul className="mt-2 divide-y divide-border rounded-xl bg-surface">
                          {row.tasks.length === 0 ? (
                            <li className="px-4 py-3 text-xs text-muted-foreground">Belum ada task terkait indikator ini.</li>
                          ) : (
                            row.tasks.map((t) => <TaskRow key={t.occurrence_id} item={t} onOpen={setOpenId} showAssignee />)
                          )}
                        </ul>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">
                      {row.weight === null ? <Badge variant="muted">tanpa bobot</Badge> : formatNumber(row.weight)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.approved}/{row.total}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Progress value={(row.rate ?? 0) * 100} aria-label={`Penyelesaian ${row.name}`} className="h-2 flex-1" />
                        <span className="w-10 text-right text-xs tabular-nums">{ratePercent(row.rate)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">
                      {formatNumber(row.contribution_total)}
                      {row.expected_total > 0 && <span className="text-xs text-muted-foreground"> / {formatNumber(row.expected_total)}</span>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      <TaskDetailSheet occurrenceId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
