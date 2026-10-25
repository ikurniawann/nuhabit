"use client";

import { AlertTriangle, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { ratePercent } from "../grouping";
import { useTaskMonitor } from "../queries";
import { STATUS_LABEL, type MonitorRow } from "../types";

const pct = (v: number | null) => (v === null ? "—" : `${v}%`);

/** Selisih hari kalender (untuk "terlambat N hari"). */
export function daysLate(date: string, today: string): number {
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
}

function MonitorRowList({ rows, today, late, onOpen }: { rows: MonitorRow[]; today: string; late: boolean; onOpen: (id: string) => void }) {
  return (
    <ul className="divide-y divide-border">
      {rows.map((o) => (
        <li key={o.occurrence_id} className="py-2 text-sm">
          <button type="button" onClick={() => onOpen(o.occurrence_id)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left">
            <span className="w-20 text-xs tabular-nums text-muted-foreground">{formatDate(o.occurrence_date)}</span>
            <span className="min-w-0 flex-1 basis-40">
              <span className="block font-medium text-foreground">{o.title}</span>
              <span className="block text-xs text-muted-foreground">
                {o.department_name} · PJ {o.assignee_name ?? "departemen"}
                {o.last_note ? ` · “${o.last_note}”` : ""}
              </span>
            </span>
            <span className="text-xs tabular-nums text-muted-foreground">{o.progress}%</span>
            {late ? <Badge variant="destructive">terlambat {daysLate(o.occurrence_date, today)} hari</Badge> : null}
            <Badge variant="outline">{STATUS_LABEL[o.status]}</Badge>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Pemantauan (EPIC-068): penyelesaian dan progres per departemen dan per
 * penanggung jawab, task terlambat dengan catatan terakhir, dan task yang
 * menunggu review Head Division.
 */
export function MonitorPanel({ month, departmentId, onOpen }: { month: string; departmentId?: string; onOpen: (id: string) => void }) {
  const monitor = useTaskMonitor({ month, department_id: departmentId });
  if (monitor.isLoading) return <p className="py-10 text-center text-sm text-muted-foreground">Memuat pemantauan…</p>;
  if (monitor.error || !monitor.data) return <p className="py-10 text-center text-sm text-danger">{monitor.error?.message ?? "Gagal memuat"}</p>;
  const d = monitor.data;
  if (d.departments.length === 0) {
    return <p className="rounded-2xl bg-surface px-5 py-10 text-center text-sm text-muted-foreground">Belum ada task departemen pada bulan ini.</p>;
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          { label: "Jatuh tempo s/d hari ini", value: String(d.summary.due), hint: `${d.summary.scheduled} terjadwal bulan ini` },
          { label: "Penyelesaian", value: ratePercent(d.summary.completion), hint: `${d.summary.approved} disetujui` },
          { label: "Progres rata-rata", value: pct(d.summary.avg_progress), hint: `${d.summary.in_progress} sedang dikerjakan` },
          { label: "Terlambat", value: String(d.summary.overdue), hint: "belum selesai lewat tanggal", danger: d.summary.overdue > 0 },
          { label: "Menunggu review", value: String(d.summary.waiting_review), hint: "perlu dicek Head Division" },
        ].map((s) => (
          <Card key={s.label} className={s.danger ? "border-danger/40" : undefined}>
            <CardContent className="p-4">
              <p className={`text-2xl font-bold tabular-nums ${s.danger ? "text-danger" : "text-foreground"}`}>{s.value}</p>
              <p className="text-xs font-medium text-foreground">{s.label}</p>
              <p className="text-xs text-muted-foreground">{s.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {d.departments.map((dept) => (
        <Card key={dept.department_id}>
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-foreground">{dept.department_name}</p>
                <p className="text-xs text-muted-foreground">
                  {dept.due} jatuh tempo · {dept.approved} disetujui · {dept.waiting_review} tunggu review · {dept.in_progress} dikerjakan
                </p>
              </div>
              {dept.overdue > 0 ? <Badge variant="destructive">{dept.overdue} terlambat</Badge> : <Badge variant="success">Tepat waktu</Badge>}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                  <span>Penyelesaian</span>
                  <span className="font-semibold tabular-nums">{ratePercent(dept.completion)}</span>
                </div>
                <Progress value={(dept.completion ?? 0) * 100} aria-label={`Penyelesaian ${dept.department_name}`} className="h-2" />
              </div>
              <div>
                <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                  <span>Progres</span>
                  <span className="font-semibold tabular-nums">{pct(dept.avg_progress)}</span>
                </div>
                <Progress value={dept.avg_progress ?? 0} aria-label={`Progres ${dept.department_name}`} className="h-2" />
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Penanggung jawab</TableHead>
                  <TableHead className="text-right">Jatuh tempo</TableHead>
                  <TableHead className="text-right">Selesai</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Progres</TableHead>
                  <TableHead className="text-right">Terlambat</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dept.assignees.map((a) => (
                  <TableRow key={a.assignee_id ?? "none"}>
                    <TableCell>{a.assignee_name}</TableCell>
                    <TableCell className="text-right tabular-nums">{a.due}</TableCell>
                    <TableCell className="text-right tabular-nums">{ratePercent(a.completion)}</TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">{pct(a.avg_progress)}</TableCell>
                    <TableCell className={`text-right font-semibold tabular-nums ${a.overdue > 0 ? "text-danger" : "text-muted-foreground"}`}>{a.overdue}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardContent className="p-4">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <AlertTriangle className="size-4 text-danger" aria-hidden /> Task terlambat
          </p>
          {d.overdue.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Tidak ada task terlambat.</p>
          ) : (
            <MonitorRowList rows={d.overdue} today={d.today} late onOpen={onOpen} />
          )}
        </CardContent>
      </Card>

      {d.waiting_review.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <Clock className="size-4 text-info" aria-hidden /> Menunggu review Head Division
            </p>
            <MonitorRowList rows={d.waiting_review} today={d.today} late={false} onOpen={onOpen} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
