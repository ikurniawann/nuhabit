"use client";

import { CalendarDays, CheckSquare, MessageSquare, Paperclip, Repeat, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import { PRIORITY_LABEL, RECURRENCE_LABEL, STATUS_LABEL, type OccurrenceStatus, type TaskItem, type TaskPriority } from "../types";

const PRIORITY_VARIANT: Record<TaskPriority, "muted" | "default" | "warning" | "destructive"> = {
  low: "muted",
  normal: "default",
  high: "warning",
  urgent: "destructive",
};

const STATUS_VARIANT: Record<OccurrenceStatus, "muted" | "info" | "warning" | "success" | "destructive"> = {
  pending: "muted",
  in_progress: "warning",
  done: "info",
  approved: "success",
  rejected: "destructive",
};

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  if (priority === "normal") return null;
  return <Badge variant={PRIORITY_VARIANT[priority]}>{PRIORITY_LABEL[priority]}</Badge>;
}

export function StatusBadge({ status, overdue }: { status: OccurrenceStatus; overdue?: boolean }) {
  if (overdue) return <Badge variant="destructive">Terlambat</Badge>;
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>;
}

/** Tanggal, progres, kadens, KPI dan hitungan sub-item satu kemunculan. */
export function TaskMetaLine({ item, showAssignee = false }: { item: TaskItem; showAssignee?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className={item.overdue ? "inline-flex items-center gap-1 font-medium text-danger" : "inline-flex items-center gap-1"}>
        <CalendarDays className="size-3.5" aria-hidden />
        {formatDate(item.occurrence_date)}
        {item.overdue ? " · terlambat" : ""}
      </span>
      {item.status === "in_progress" && <span className="tabular-nums">{item.progress}%</span>}
      {item.recurrence !== "once" && (
        <span className="inline-flex items-center gap-1">
          <Repeat className="size-3.5" aria-hidden />
          {RECURRENCE_LABEL[item.recurrence]}
        </span>
      )}
      {item.kpi_indicator_name && (
        <span className="inline-flex items-center gap-1">
          <Target className="size-3.5" aria-hidden />
          {item.kpi_indicator_name}
          {item.kpi_contribution !== null ? ` (+${item.kpi_contribution})` : ""}
        </span>
      )}
      {item.subtask_count > 0 && (
        <span className="inline-flex items-center gap-1">
          <CheckSquare className="size-3.5" aria-hidden />
          {item.subtask_count} sub-task
        </span>
      )}
      {item.comment_count > 0 && (
        <span className="inline-flex items-center gap-1">
          <MessageSquare className="size-3.5" aria-hidden />
          {item.comment_count}
        </span>
      )}
      {item.attachment_count > 0 && (
        <span className="inline-flex items-center gap-1">
          <Paperclip className="size-3.5" aria-hidden />
          {item.attachment_count}
        </span>
      )}
      {showAssignee && <span>PJ: {item.assignee_name ?? "departemen"}</span>}
      {item.last_note && (
        <span className="max-w-full truncate" title={item.last_note}>
          “{item.last_note}”
        </span>
      )}
    </div>
  );
}
