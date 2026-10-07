"use client";

import { formatDateTime } from "@/lib/format";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CalendarDaysIcon, CheckCircleIcon } from "@heroicons/react/24/outline";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { dayKey, visibleRange, type CalendarMode } from "../calendar";
import { useDeleteTask, useTasks, useUpdateTask } from "../queries";
import {
  PRIORITY_BADGE,
  PRIORITY_LABELS,
  STATUS_LABELS,
  SUBJECT_LABELS,
  TASK_TYPE_LABELS,
  isOverdue,
  type SalesTask,
  type TaskFilters,
  type TaskPriority,
} from "../types";
import { CalendarView } from "./calendar-view";
import { TaskFormDialog } from "./task-form-dialog";

const ALL = "all";
type ListTab = "today" | "upcoming" | "done";

function subjectHref(task: SalesTask): string | null {
  switch (task.subject_type) {
    case "lead":
      return `/dashboard/sales-funnel/leads/${task.subject_id}`;
    case "deal":
      return `/dashboard/sales-funnel/pipeline?deal=${task.subject_id}`;
    case "account":
      return `/dashboard/sales-funnel/accounts/${task.subject_id}`;
    case "contact":
      return `/dashboard/sales-funnel/contacts?q=${encodeURIComponent(task.pic_phone ?? "")}`;
    case "member":
      return `/dashboard/crm/members/${task.subject_id}`;
    default:
      return task.lead_id ? `/dashboard/sales-funnel/leads/${task.lead_id}` : null;
  }
}


/**
 * EPIC-050 Fase 1 (T-1.5) — Tasks & Kalender: menggantikan "Follow-up Hari Ini".
 * Tab list (Hari ini & terlambat / Mendatang / Selesai) + kalender hari/minggu/bulan.
 */
export function SalesTasksPage() {
  const searchParams = useSearchParams();
  const [layout, setLayout] = useState<"list" | "calendar">("list");
  const [tab, setTab] = useState<ListTab>("today");
  const [priority, setPriority] = useState(ALL);
  const [mode, setMode] = useState<CalendarMode>("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const [editing, setEditing] = useState<SalesTask | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<SalesTask | null>(null);

  const listFilters = useMemo<TaskFilters>(() => {
    const base: TaskFilters = { priority: priority === ALL ? "" : (priority as TaskPriority) };
    if (tab === "today") return { ...base, view: "today" };
    if (tab === "upcoming") return { ...base, view: "upcoming" };
    return { ...base, view: "all", status: "done" };
  }, [tab, priority]);

  const calendarFilters = useMemo<TaskFilters>(() => {
    const { from, to } = visibleRange(anchor, mode);
    return { view: "range", from: dayKey(from), to: dayKey(to) };
  }, [anchor, mode]);

  const listQuery = useTasks(listFilters, layout === "list");
  const calendarQuery = useTasks(calendarFilters, layout === "calendar");
  const updateMutation = useUpdateTask();
  const deleteMutation = useDeleteTask();

  // Deep-link dari notifikasi in-app: ?task=<id> → buka task tsb (sekali per id,
  // pola "adjust state during render" — tanpa setState di dalam effect).
  const focusTaskId = searchParams.get("task");
  const listRows = useMemo(() => listQuery.data ?? [], [listQuery.data]);
  const calendarRows = useMemo(() => calendarQuery.data ?? [], [calendarQuery.data]);
  const [handledFocusId, setHandledFocusId] = useState<string | null>(null);
  if (focusTaskId && focusTaskId !== handledFocusId) {
    const found = listRows.find((t) => t.id === focusTaskId) ?? calendarRows.find((t) => t.id === focusTaskId);
    if (found) {
      setHandledFocusId(focusTaskId);
      setEditing(found);
      setFormOpen(true);
    }
  }

  const openEdit = (task: SalesTask) => {
    setEditing(task);
    setFormOpen(true);
  };

  const overdue = listRows.filter((t) => isOverdue(t)).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tasks & Kalender</h1>
          <p className="mt-1 text-sm text-gray-500">
            Semua tugas sales dari lead, deal, account, contact, dan member — pengingat lewat WA & notifikasi aplikasi.
            {layout === "list" && tab === "today" && overdue > 0 ? (
              <span className="ml-1 font-semibold text-red-600">{overdue} terlambat.</span>
            ) : null}
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
          {(["list", "calendar"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setLayout(value)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${layout === value ? "bg-pink-600 text-white" : "text-gray-600 hover:bg-gray-100"}`}
            >
              {value === "list" ? "Daftar" : "Kalender"}
            </button>
          ))}
        </div>
      </div>

      <PurchasingListSection
        icon={layout === "list" ? CheckCircleIcon : CalendarDaysIcon}
        title={layout === "list" ? "Daftar Task" : "Kalender Task"}
        description={
          layout === "list"
            ? "Task dibuat dari halaman lead, deal, account, contact, atau member. Tandai selesai di sini."
            : "Klik task untuk membuka detail; klik tanggal untuk melihat hari itu."
        }
        toolbar={
          layout === "list" ? (
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
              <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
                {(
                  [
                    ["today", "Hari ini & terlambat"],
                    ["upcoming", "Mendatang"],
                    ["done", "Selesai"],
                  ] as Array<[ListTab, string]>
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setTab(value)}
                    className={`rounded-md px-3 py-1 text-xs font-semibold ${tab === value ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="h-10 bg-white sm:w-36"><SelectValue placeholder="Prioritas" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Semua prioritas</SelectItem>
                  {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <p className="text-xs text-gray-500">
              Task baru dibuat dari halaman lead, deal, account, contact, atau member.
            </p>
          )
        }
      >
        {layout === "calendar" ? (
          calendarQuery.isLoading ? (
            <div className="py-14 text-center"><Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" /></div>
          ) : (
            <CalendarView
              anchor={anchor}
              mode={mode}
              tasks={calendarRows}
              onAnchorChange={setAnchor}
              onModeChange={setMode}
              onSelectTask={openEdit}
              onCreateAt={(date) => {
                setAnchor(date);
                setMode("day");
              }}
            />
          )
        ) : listQuery.isLoading ? (
          <div className="py-14 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" />
            <p className="mt-2 text-sm text-gray-500">Memuat task...</p>
          </div>
        ) : listRows.length === 0 ? (
          <div className="py-14 text-center">
            <CheckCircleIcon className="mx-auto mb-4 h-12 w-12 text-gray-300" />
            <p className="text-gray-500">
              {tab === "today" ? "Tidak ada task jatuh tempo hari ini. 🎉" : tab === "upcoming" ? "Belum ada task mendatang." : "Belum ada task selesai."}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-200/60">
            {listRows.map((task) => {
              const href = subjectHref(task);
              const late = isOverdue(task);
              const done = task.status === "done";
              return (
                <li key={task.id} className="flex flex-col gap-2 px-5 py-3 text-sm sm:flex-row sm:items-center">
                  <button
                    type="button"
                    className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border ${done ? "border-emerald-500 bg-emerald-500 text-white" : "border-gray-300 hover:border-emerald-500"}`}
                    title={done ? "Tandai belum selesai" : "Tandai selesai"}
                    onClick={() => updateMutation.mutate({ id: task.id, values: { status: done ? "open" : "done" } })}
                  >
                    {done ? "✓" : ""}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button type="button" onClick={() => openEdit(task)} className={`font-medium text-left ${done ? "text-gray-400 line-through" : "text-gray-900 hover:text-pink-700"}`}>
                        {task.title ?? TASK_TYPE_LABELS[task.activity_type]}
                      </button>
                      <Badge className={PRIORITY_BADGE[task.priority]}>{PRIORITY_LABELS[task.priority]}</Badge>
                      {task.recurrence ? <Badge className="border-0 bg-violet-100 font-normal text-violet-700">berulang</Badge> : null}
                      {task.status === "in_progress" ? <Badge className="border-0 bg-amber-100 font-normal text-amber-700">{STATUS_LABELS.in_progress}</Badge> : null}
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {task.subject_type ? `${SUBJECT_LABELS[task.subject_type]}: ` : ""}
                      {href ? (
                        <Link href={href} className="font-medium text-pink-600 hover:underline">{task.subject_name ?? "-"}</Link>
                      ) : (
                        task.subject_name ?? "-"
                      )}
                      {task.deal_title && task.subject_type !== "deal" ? ` · ${task.deal_title}` : ""}
                      {task.owner_name ? ` · PJ: ${task.owner_name}` : ""}
                    </p>
                    {task.notes ? <p className="mt-0.5 line-clamp-2 text-xs text-gray-600">{task.notes}</p> : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-xs">
                    <span className={late ? "font-semibold text-red-600" : "text-gray-500"}>{formatDateTime(task.due_at, "Tanpa jatuh tempo")}</span>
                    {task.pic_phone && task.subject_type !== "member" ? (
                      <a href={`https://wa.me/${task.pic_phone}`} target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:underline">WA</a>
                    ) : null}
                    <button type="button" className="text-gray-400 hover:text-red-600" onClick={() => setDeleting(task)}>Hapus</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </PurchasingListSection>

      <TaskFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        }}
        task={editing}
        subject={null}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Hapus task?"
        description={deleting ? `Task "${deleting.title ?? deleting.activity_type}" akan dihapus.` : ""}
        confirmLabel="Hapus"
        onConfirm={() => {
          if (deleting) deleteMutation.mutate(deleting.id);
          setDeleting(null);
        }}
      />
    </div>
  );
}
