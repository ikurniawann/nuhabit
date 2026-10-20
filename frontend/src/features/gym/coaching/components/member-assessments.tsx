"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { TableNote } from "@/features/crm/engagement/components/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  formatChange,
  formatMetric,
  metricProgress,
  metricSeries,
  METRICS,
  type Assessment,
  type Metric,
  type MetricKey,
} from "@/lib/gym/assessments";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SELECT } from "@/features/gym/shared";
import { COACHING_KEYS, coachingApi } from "../api";
import { AssessmentDialog } from "./assessment-dialog";

const AXIS = { fontSize: 11, fill: "var(--color-muted-foreground)" };

/** Tab Asesmen di profil 360 member: progres per metrik, grafik, dan riwayat. */
export function MemberAssessments({ customerId }: { customerId: string }) {
  const queryClient = useQueryClient();
  const history = useQuery({
    queryKey: [...COACHING_KEYS.assessments, "member", customerId],
    queryFn: () => coachingApi.assessments({ customer_id: customerId }),
  });
  const [editing, setEditing] = useState<Assessment | "new" | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: COACHING_KEYS.assessments });
  const remove = useMutation({
    mutationFn: coachingApi.deleteAssessment,
    onSuccess: () => {
      toast.success("Asesmen dihapus");
      refresh();
    },
    onError: (error) => toast.error("Asesmen gagal dihapus", { description: error.message }),
  });

  if (history.isLoading) {
    return (
      <Card>
        <TableNote>Memuat asesmen…</TableNote>
      </Card>
    );
  }
  if (history.error) {
    return (
      <Card>
        <TableNote tone="danger">{history.error.message}</TableNote>
      </Card>
    );
  }
  const rows = history.data ?? [];
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing("new")}>
          <Plus /> Catat asesmen
        </Button>
      </div>
      {rows.length === 0 ? (
        <Card>
          <TableNote>Belum ada asesmen kebugaran.</TableNote>
        </Card>
      ) : (
        <>
          <ProgressGrid history={rows} />
          <MetricChart history={rows} />
          {rows[0]!.goals && (
            <Card className="gap-1 p-4">
              <h3 className="text-sm font-semibold">Target terakhir</h3>
              <p className="text-sm whitespace-pre-line">{rows[0]!.goals}</p>
            </Card>
          )}
          <Card className="py-0">
            <h2 className="px-5 pt-4 text-sm font-semibold">Riwayat asesmen</h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Coach</TableHead>
                  {METRICS.map((m) => (
                    <TableHead key={m.key} className="text-right whitespace-nowrap">
                      {m.label}
                    </TableHead>
                  ))}
                  <TableHead>Catatan</TableHead>
                  <TableHead className="sr-only">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="whitespace-nowrap">{formatDate(a.assessed_on)}</TableCell>
                    <TableCell>{a.coach_name ?? "-"}</TableCell>
                    {METRICS.map((m) => (
                      <TableCell key={m.key} className="text-right whitespace-nowrap tabular-nums">
                        {formatMetric(m, a[m.key])}
                      </TableCell>
                    ))}
                    <TableCell className="max-w-[16rem] truncate" title={a.notes}>
                      {a.notes || "-"}
                    </TableCell>
                    <TableCell>
                      <span className="flex gap-1">
                        <Button variant="ghost" size="icon-sm" aria-label="Ubah asesmen" onClick={() => setEditing(a)}>
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Hapus asesmen"
                          disabled={remove.isPending}
                          onClick={() => {
                            if (window.confirm(`Hapus asesmen ${formatDate(a.assessed_on)}?`)) remove.mutate(a.id);
                          }}
                        >
                          <Trash2 />
                        </Button>
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
      {editing && (
        <AssessmentDialog
          customerId={customerId}
          assessment={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}

/** Nilai terbaru tiap metrik yang pernah diukur, dengan perubahan sejak asesmen pertama. */
function ProgressGrid({ history }: { history: Assessment[] }) {
  const items = METRICS.map((m) => ({ m, p: metricProgress(m, metricSeries(history, m.key)) })).filter(
    (x): x is { m: Metric; p: NonNullable<ReturnType<typeof metricProgress>> } => x.p !== null
  );
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {items.map(({ m, p }) => (
        <Card key={m.key} size="sm" className="gap-1 p-3">
          <p className="text-xs text-muted-foreground">{m.label}</p>
          <p className="text-lg font-semibold tabular-nums">{formatMetric(m, p.latest)}</p>
          {p.change !== null && (
            <p className={cn("text-xs tabular-nums", p.improved === null ? "text-muted-foreground" : p.improved ? "text-success" : "text-warning")}>
              {formatChange(m, p.change)} {p.improved === null ? "" : p.improved ? "membaik" : "menurun"}
            </p>
          )}
        </Card>
      ))}
    </div>
  );
}

/** Grafik garis satu metrik; tabel riwayat di bawahnya memuat angka yang sama. */
function MetricChart({ history }: { history: Assessment[] }) {
  const measured = METRICS.filter((m) => metricSeries(history, m.key).length >= 2);
  const [chosen, setChosen] = useState<MetricKey | "">("");
  const metric = measured.find((m) => m.key === chosen) ?? measured[0];
  if (!metric) return null;
  const series = metricSeries(history, metric.key);
  const progress = metricProgress(metric, series);
  return (
    <Card className="gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Progres {metric.label}</h3>
        <select
          className={cn(SELECT, "w-auto min-w-48")}
          value={metric.key}
          aria-label="Metrik grafik"
          onChange={(e) => setChosen(e.target.value as MetricKey)}
        >
          {measured.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
      <figure
        role="img"
        aria-label={`Grafik ${metric.label} dari ${series.length} asesmen, terbaru ${formatMetric(metric, progress?.latest)}.`}
        className="h-56 w-full"
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--color-border)" />
            <XAxis dataKey="date" tickFormatter={(d) => formatDate(String(d))} tick={AXIS} tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis
              tick={AXIS}
              tickLine={false}
              axisLine={false}
              domain={["auto", "auto"]}
              tickFormatter={(v) => formatMetric({ ...metric, unit: "" }, Number(v))}
              width={48}
            />
            <Tooltip
              contentStyle={{ borderRadius: 12, border: "none", background: "var(--color-ink)", color: "var(--color-on-ink)", fontSize: 12 }}
              labelStyle={{ color: "var(--color-on-ink)" }}
              itemStyle={{ color: "var(--color-on-ink)" }}
              labelFormatter={(d) => formatDate(String(d))}
              formatter={(v) => [formatMetric(metric, Number(v)), metric.label]}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke="var(--color-brand-text)"
              strokeWidth={2}
              dot={{ r: 4, fill: "var(--color-brand-text)", stroke: "var(--color-card)", strokeWidth: 2 }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </figure>
    </Card>
  );
}
