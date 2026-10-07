"use client";

import { formatTime } from "@/lib/format";
import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  bucketByDay,
  dayKey,
  formatRangeLabel,
  monthGrid,
  shiftAnchor,
  weekDays,
  type CalendarMode,
} from "../calendar";
import { PRIORITY_BADGE, isOverdue, type SalesTask } from "../types";

interface CalendarViewProps {
  anchor: Date;
  mode: CalendarMode;
  tasks: SalesTask[];
  onAnchorChange: (date: Date) => void;
  onModeChange: (mode: CalendarMode) => void;
  onSelectTask: (task: SalesTask) => void;
  onCreateAt: (date: Date) => void;
}

const DAY_HEADERS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
const MODES: Array<{ value: CalendarMode; label: string }> = [
  { value: "day", label: "Hari" },
  { value: "week", label: "Minggu" },
  { value: "month", label: "Bulan" },
];

const timeLabel = (iso: string | null) => formatTime(iso, "");

function TaskChip({ task, onClick }: { task: SalesTask; onClick: () => void }) {
  const done = task.status === "done" || task.status === "cancelled";
  const overdue = isOverdue(task);
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${task.title ?? task.activity_type} — ${task.subject_name ?? ""}`}
      className={`block w-full truncate rounded-md border px-1.5 py-0.5 text-left text-[11px] leading-4 ${
        done
          ? "border-gray-200 bg-gray-50 text-gray-400 line-through"
          : overdue
            ? "border-red-200 bg-red-50 text-red-700"
            : task.priority === "urgent" || task.priority === "high"
              ? "border-orange-200 bg-orange-50 text-orange-800"
              : "border-pink-200 bg-pink-50 text-pink-800"
      }`}
    >
      <span className="mr-1 font-mono text-[10px] text-gray-500">{timeLabel(task.due_at)}</span>
      {task.title ?? task.activity_type}
    </button>
  );
}

/** EPIC-050 T-1.5 — kalender hari/minggu/bulan tanpa dependensi tambahan. */
export function CalendarView({
  anchor,
  mode,
  tasks,
  onAnchorChange,
  onModeChange,
  onSelectTask,
  onCreateAt,
}: CalendarViewProps) {
  const buckets = useMemo(() => bucketByDay(tasks), [tasks]);
  const todayKey = dayKey(new Date());

  const header = (
    <div className="flex flex-col gap-2 border-b border-gray-200/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-1">
        <Button type="button" variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => onAnchorChange(shiftAnchor(anchor, mode, -1))} aria-label="Sebelumnya">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => onAnchorChange(shiftAnchor(anchor, mode, 1))} aria-label="Berikutnya">
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => onAnchorChange(new Date())}>
          Hari ini
        </Button>
        <span className="ml-2 text-sm font-semibold text-gray-900">{formatRangeLabel(anchor, mode)}</span>
      </div>
      <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            onClick={() => onModeChange(m.value)}
            className={`rounded-md px-3 py-1 text-xs font-semibold ${mode === m.value ? "bg-pink-600 text-white" : "text-gray-600 hover:bg-gray-100"}`}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );

  if (mode === "day") {
    const key = dayKey(anchor);
    const list = buckets.get(key) ?? [];
    return (
      <div>
        {header}
        <div className="p-4">
          {list.length === 0 ? (
            <p className="rounded-xl border border-dashed border-gray-300 py-10 text-center text-sm text-gray-400">
              Tidak ada task pada hari ini.{" "}
              <button type="button" className="font-semibold text-pink-600 hover:underline" onClick={() => onCreateAt(anchor)}>
                Tambah task
              </button>
            </p>
          ) : (
            <ul className="space-y-2">
              {list.map((task) => (
                <li key={task.id} className="flex items-center gap-3 rounded-xl border border-gray-200/80 bg-white p-3 text-sm">
                  <span className="w-12 font-mono text-xs text-gray-500">{timeLabel(task.due_at)}</span>
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onSelectTask(task)}>
                    <span className={`font-medium ${task.status === "done" ? "text-gray-400 line-through" : "text-gray-900"}`}>
                      {task.title ?? task.activity_type}
                    </span>
                    <span className="ml-2 text-xs text-gray-500">{task.subject_name}</span>
                  </button>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] ${PRIORITY_BADGE[task.priority]}`}>{task.priority}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  if (mode === "week") {
    const days = weekDays(anchor);
    return (
      <div>
        {header}
        <div className="grid grid-cols-7 divide-x divide-gray-200/70 border-b border-gray-200/70">
          {days.map((d, i) => (
            <div key={d.key} className={`min-h-[260px] p-2 ${d.key === todayKey ? "bg-pink-50/40" : ""}`}>
              <button
                type="button"
                onClick={() => onCreateAt(d.date)}
                className="mb-1 flex w-full items-baseline justify-between text-xs text-gray-500 hover:text-pink-700"
                title="Tambah task di tanggal ini"
              >
                <span className="font-semibold uppercase">{DAY_HEADERS[i]}</span>
                <span className={`text-sm ${d.key === todayKey ? "font-bold text-pink-700" : "text-gray-700"}`}>{d.date.getDate()}</span>
              </button>
              <div className="space-y-1">
                {(buckets.get(d.key) ?? []).map((task) => (
                  <TaskChip key={task.id} task={task} onClick={() => onSelectTask(task)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const cells = monthGrid(anchor);
  return (
    <div>
      {header}
      <div className="grid grid-cols-7 border-b border-gray-200/70 bg-gray-50/80 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        {DAY_HEADERS.map((h) => (
          <div key={h} className="py-1.5">{h}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((cell) => {
          const list = buckets.get(cell.key) ?? [];
          const extra = list.length - 3;
          return (
            <div
              key={cell.key}
              className={`min-h-[104px] border-b border-r border-gray-200/60 p-1.5 ${cell.inMonth ? "" : "bg-gray-50/60"} ${cell.key === todayKey ? "bg-pink-50/40" : ""}`}
            >
              <button
                type="button"
                onClick={() => onCreateAt(cell.date)}
                className={`mb-1 block w-full text-right text-xs ${cell.inMonth ? "text-gray-700" : "text-gray-400"} ${cell.key === todayKey ? "font-bold text-pink-700" : ""} hover:text-pink-700`}
                title="Tambah task di tanggal ini"
              >
                {cell.date.getDate()}
              </button>
              <div className="space-y-0.5">
                {list.slice(0, 3).map((task) => (
                  <TaskChip key={task.id} task={task} onClick={() => onSelectTask(task)} />
                ))}
                {extra > 0 ? (
                  <button
                    type="button"
                    className="w-full text-left text-[11px] font-medium text-gray-500 hover:text-pink-700"
                    onClick={() => {
                      onAnchorChange(cell.date);
                      onModeChange("day");
                    }}
                  >
                    +{extra} lagi
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
