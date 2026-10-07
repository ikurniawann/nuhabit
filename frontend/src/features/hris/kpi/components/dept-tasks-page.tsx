"use client";

import { useMemo, useState } from "react";
import { ClipboardCheck, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { currentMonthWib } from "@/lib/hris/attendance-calendar";
import {
  groupByTask,
  hasOpenToday,
  indexChecked,
  summarizeOccurrences,
} from "@/lib/kpi/ui-dept-tasks";
import { todayWib } from "@/lib/dates";
import { useDeptTasks } from "../queries";
import { useDeptOccurrenceAction } from "../mutations";
import type { DeptOccurrenceAction, DeptTaskRow } from "../types";
import { DeptTaskFormDialog } from "./dept-task-form-dialog";
import { HARI, RECURRENCE_LABEL, SECTION_ORDER } from "./dept-task-meta";
import { DeptTaskOccurrence } from "./dept-task-occurrence";

/**
 * Task Departemen (owner 2026-08-30), konsep MBO / task compliance:
 * departemen menyusun daftar tugas (rutin harian/mingguan/bulanan atau
 * sekali jalan), penanggung jawab menandai selesai, HRD mereview, dan
 * hasilnya menjadi indikator KPI "Penyelesaian Tugas Departemen".
 */

/** Grup task yang bisa di-expand; state terbuka/tutup lokal per grup. */
function TaskGroup({
  header,
  defaultOpen = false,
  children,
}: {
  header: (open: boolean) => React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-muted/30"
        onClick={() => setOpen((v) => !v)}
      >
        {header(open)}
      </button>
      {open ? children : null}
    </div>
  );
}

function recurrenceDetail(task: DeptTaskRow): string {
  if (task.recurrence === "weekly" && task.weekly_day) return ` · ${HARI[task.weekly_day]}`;
  if (task.recurrence === "monthly" && task.monthly_day) return ` · tgl ${task.monthly_day}`;
  return "";
}

export function DeptTasksPage() {
  const [month, setMonth] = useState(() => currentMonthWib());
  const [deptFilter, setDeptFilter] = useState<string>("");
  const [addOpen, setAddOpen] = useState(false);
  const [expandedOcc, setExpandedOcc] = useState<string | null>(null);
  const todayIso = useMemo(() => todayWib(), []);

  const tasksQuery = useDeptTasks(month, deptFilter);
  const data = tasksQuery.data ?? null;
  const occAction = useDeptOccurrenceAction();
  const busyId = occAction.isPending ? occAction.variables.occurrenceId : null;

  const occurrences = useMemo(() => data?.occurrences ?? [], [data?.occurrences]);
  const occByTask = useMemo(() => groupByTask(occurrences), [occurrences]);
  const subtasksByTask = useMemo(() => groupByTask(data?.subtasks ?? []), [data?.subtasks]);
  const checked = useMemo(() => indexChecked(data?.checked_items ?? []), [data?.checked_items]);
  const summary = summarizeOccurrences(occurrences);

  function runAction(occurrenceId: string, body: DeptOccurrenceAction) {
    occAction.mutate(
      { occurrenceId, body },
      {
        onSuccess: (res) => toast.success(res.message ?? "Tersimpan"),
        onError: (err) => toast.error(err.message || "Gagal"),
      }
    );
  }

  function act(occurrenceId: string, action: "done" | "approve" | "reject") {
    if (action === "reject") {
      runAction(occurrenceId, {
        action,
        notes: window.prompt("Alasan penolakan (opsional):") ?? null,
      });
    } else {
      runAction(occurrenceId, { action });
    }
  }

  function toggleSubtask(occurrenceId: string, subtaskId: string, isChecked: boolean) {
    if (busyId !== null) return; // cegah badai event/klik ganda
    runAction(occurrenceId, { action: "check_subtask", subtask_id: subtaskId, checked: isChecked });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
            <ClipboardCheck className="h-6 w-6 text-brand-text" />
            Task Departemen
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Tugas rutin & sekali jalan departemen — ditandai selesai oleh
            penanggung jawab, direview Head Division, dan dihitung ke KPI
            &quot;Penyelesaian Tugas Departemen&quot;.
          </p>
        </div>
        <div className="flex items-end gap-2">
          {data?.is_hr && data.departments.length > 0 ? (
            <div className="w-52">
              <Combobox
                value={deptFilter}
                onChange={setDeptFilter}
                options={data.departments.map((d) => ({ value: d.id, label: d.name }))}
                placeholder="Pilih departemen…"
              />
            </div>
          ) : null}
          <Input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="h-9 w-40"
          />
          {data?.can_manage ? (
            <Button onClick={() => setAddOpen(true)} disabled={!data.department_id}>
              <Plus className="mr-1.5 h-4 w-4" /> Tambah Task
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Jatuh tempo bulan ini", value: summary.total },
          { label: "Menunggu review Head", value: summary.waiting },
          { label: "Disetujui", value: summary.approved },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-2xl font-bold text-gray-900">{s.value}</p>
              <p className="text-xs text-gray-500">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {tasksQuery.isError ? (
        <Card>
          <CardContent className="p-6 text-sm text-red-600">
            {tasksQuery.error.message || "Gagal memuat task"}
          </CardContent>
        </Card>
      ) : !data ? (
        <Card>
          <CardContent className="flex items-center gap-2 p-6 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Memuat…
          </CardContent>
        </Card>
      ) : !data.department_id ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-gray-500">
            {data.is_hr
              ? "Pilih departemen untuk melihat task-nya."
              : "Akun Anda belum terhubung ke departemen — hubungi HRD."}
          </CardContent>
        </Card>
      ) : occurrences.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-gray-500">
            Belum ada task pada bulan ini.
            {data.can_manage ? " Mulai dengan Tambah Task." : ""}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {SECTION_ORDER.map((section) => {
            const sectionTasks = data.tasks.filter(
              (t) => t.recurrence === section.key && occByTask.has(t.id)
            );
            if (sectionTasks.length === 0) return null;
            return (
              <Card key={section.key}>
                <CardContent className="p-0">
                  <div
                    className={`border-b px-4 py-2 text-xs font-semibold uppercase tracking-wide ${section.cls}`}
                  >
                    {section.label}
                  </div>
                  <div className="divide-y">
                    {sectionTasks.map((task) => {
                      const taskOccs = occByTask.get(task.id) ?? [];
                      const taskSummary = summarizeOccurrences(taskOccs);
                      return (
                        <TaskGroup
                          key={task.id}
                          defaultOpen={task.recurrence === "once"}
                          header={(open) => (
                            <>
                              <span className="w-4 text-gray-400">{open ? "▾" : "▸"}</span>
                              <span className="min-w-0 flex-1">
                                <span className={`block text-sm font-semibold ${section.titleCls}`}>
                                  {task.title}
                                  <span className="ml-2 text-xs text-gray-400">
                                    {RECURRENCE_LABEL[task.recurrence]}
                                    {recurrenceDetail(task)}
                                  </span>
                                </span>
                                <span className="block truncate text-xs text-gray-500">
                                  PJ: {task.assignee_name ?? "Departemen"}
                                </span>
                              </span>
                              {hasOpenToday(taskOccs, todayIso) ? (
                                <Badge className="bg-primary/10 text-brand-text">Ada tugas hari ini</Badge>
                              ) : null}
                              <span className="text-xs tabular-nums text-gray-500">
                                {taskSummary.approved} disetujui
                                {taskSummary.waiting ? ` · ${taskSummary.waiting} tunggu review` : ""}
                                {" · "}
                                {taskSummary.total} jadwal
                              </span>
                            </>
                          )}
                        >
                          <div className="divide-y border-t bg-muted/10">
                            {taskOccs.map((occ) => (
                              <DeptTaskOccurrence
                                key={occ.id}
                                occ={occ}
                                subtasks={subtasksByTask.get(occ.task_id) ?? []}
                                checked={checked}
                                todayIso={todayIso}
                                expanded={expandedOcc === occ.id}
                                canReview={data.can_review ?? data.is_hr}
                                busyId={busyId}
                                onToggleExpand={() =>
                                  setExpandedOcc(expandedOcc === occ.id ? null : occ.id)
                                }
                                onAction={(action) => act(occ.id, action)}
                                onToggleSubtask={(subtaskId, isChecked) =>
                                  toggleSubtask(occ.id, subtaskId, isChecked)
                                }
                              />
                            ))}
                          </div>
                        </TaskGroup>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <DeptTaskFormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        departmentId={deptFilter || data?.department_id || undefined}
        members={data?.members ?? []}
      />
    </div>
  );
}
