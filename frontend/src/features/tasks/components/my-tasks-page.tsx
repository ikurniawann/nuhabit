"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIamAccess } from "@/components/iam/iam-access-provider";
import { IAM } from "@/lib/iam/prefixes";
import { todayWib } from "@/lib/dates";
import { completionSummary, groupBySection, SECTION_LABEL, SECTION_ORDER } from "../grouping";
import { useTaskItems, useTaskMeta } from "../queries";
import type { TaskView } from "../types";
import { QuickCapture } from "./quick-capture";
import { TaskDetailSheet } from "./task-detail-sheet";
import { TaskRow } from "./task-row";

const VIEWS: { value: TaskView; label: string }[] = [
  { value: "today", label: "Hari ini" },
  { value: "week", label: "Minggu ini" },
  { value: "month", label: "Bulan ini" },
];

/** Tugas Saya: jadwal task sendiri per hari, minggu, bulan; terlambat selalu di atas. */
export function MyTasksPage() {
  const [view, setView] = useState<TaskView>("today");
  const [openId, setOpenId] = useState<string | null>(null);
  const meta = useTaskMeta();
  const today = meta.data?.today ?? todayWib();
  const items = useTaskItems({ scope: "mine", view });
  const rows = useMemo(() => items.data ?? [], [items.data]);
  const sections = useMemo(() => groupBySection(rows, today), [rows, today]);
  const summary = completionSummary(rows);
  const { hasPrefix } = useIamAccess();
  const teamScope = meta.data?.team_scope ?? "none";

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Tugas"
        title="Tugas Saya"
        description={
          items.data
            ? `${summary.open} terbuka${summary.overdue ? `, ${summary.overdue} terlambat` : ""}${summary.review ? `, ${summary.review} menunggu review` : ""}, ${summary.approved} selesai.`
            : "Tugas harian, mingguan dan bulanan Anda, dari departemen maupun catatan sendiri."
        }
        actions={
          <nav aria-label="Tampilan lain" className="flex flex-wrap gap-3 text-sm">
            {(teamScope !== "none" || hasPrefix(IAM.tasksTeam)) && (
              <Link href="/dashboard/tasks/team" className="text-brand-text underline-offset-4 hover:underline">
                Papan tim
              </Link>
            )}
            <Link href="/dashboard/tasks/kpi" className="text-brand-text underline-offset-4 hover:underline">
              KPI & tugas
            </Link>
          </nav>
        }
      />

      {meta.data && <QuickCapture meta={meta.data} />}

      <Tabs value={view} onValueChange={(v) => setView(v as TaskView)}>
        <TabsList aria-label="Rentang waktu">
          {VIEWS.map((v) => (
            <TabsTrigger key={v.value} value={v.value}>
              {v.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card className="py-0">
        {items.isLoading ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">Memuat tugas…</p>
        ) : items.error ? (
          <p className="px-5 py-10 text-center text-sm text-danger">{items.error.message}</p>
        ) : rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">
            Tidak ada tugas {VIEWS.find((v) => v.value === view)?.label.toLowerCase()}. Tambahkan lewat kotak di atas.
          </p>
        ) : (
          SECTION_ORDER.filter((s) => sections[s].length > 0).map((s) => (
            <section key={s} aria-labelledby={`tasks-section-${s}`}>
              <h2
                id={`tasks-section-${s}`}
                className={
                  s === "overdue"
                    ? "border-b border-border px-4 py-2 text-xs font-semibold uppercase tracking-wide text-danger"
                    : "border-b border-border px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                }
              >
                {SECTION_LABEL[s]} · {sections[s].length}
              </h2>
              <ul className="divide-y divide-border">
                {sections[s].map((t) => (
                  <TaskRow key={t.occurrence_id} item={t} onOpen={setOpenId} />
                ))}
              </ul>
            </section>
          ))
        )}
      </Card>

      <TaskDetailSheet occurrenceId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
