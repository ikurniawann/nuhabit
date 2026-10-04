"use client";

import { formatDateLong, formatTime } from "@/lib/format";
import { useMemo } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  CircleDashed,
  FileText,
  Flag,
  Loader2,
  MessageCircle,
  Receipt,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { groupByDay, type TimelineEvent, type TimelineKind } from "@/lib/sales-funnel/timeline";
import type { TaskSubjectType } from "@/lib/sales-funnel/tasks";
import { useRecordTimeline } from "../queries";

const KIND_ICON: Record<TimelineKind, typeof Flag> = {
  task: CircleDashed,
  activity: MessageCircle,
  stage: Flag,
  quotation: FileText,
  invoice: Receipt,
  wa: MessageCircle,
  lead: UserPlus,
  deal: Sparkles,
  note: FileText,
};

const KIND_COLOR: Record<TimelineKind, string> = {
  task: "bg-amber-100 text-amber-700",
  activity: "bg-sky-100 text-sky-700",
  stage: "bg-pink-100 text-pink-700",
  quotation: "bg-violet-100 text-violet-700",
  invoice: "bg-emerald-100 text-emerald-700",
  wa: "bg-green-100 text-green-700",
  lead: "bg-blue-100 text-blue-700",
  deal: "bg-pink-100 text-pink-700",
  note: "bg-gray-100 text-gray-700",
};

const BADGE_LABEL: Record<string, string> = {
  open: "Terbuka",
  in_progress: "Dikerjakan",
  done: "Selesai",
  cancelled: "Dibatalkan",
  draft: "Draft",
  sent: "Terkirim",
  paid: "Lunas",
  unpaid: "Belum bayar",
};

/** Header grup: kunci YYYY-MM-DD dari groupByDay (WIB). */
const formatDay = (day: string) => formatDateLong(day, "Tanpa tanggal");

interface RecordTimelineProps {
  subjectType: TaskSubjectType;
  subjectId: string;
  /** dipanggil saat user menekan "Selesai" pada task terbuka (opsional) */
  onCompleteTask?: (taskId: string) => void;
  emptyText?: string;
  className?: string;
  /** sembunyikan komponen bila API menolak (403) — untuk halaman lintas modul */
  hideOnForbidden?: boolean;
}

/**
 * EPIC-050 Fase 1 (T-1.4) — timeline terpadu satu record: task/aktivitas,
 * tahap deal, quotation, invoice, pesan WA, lead & deal yang dibuat.
 */
export function RecordTimeline({
  subjectType,
  subjectId,
  onCompleteTask,
  emptyText = "Belum ada riwayat untuk record ini.",
  className,
  hideOnForbidden = false,
}: RecordTimelineProps) {
  const timelineQuery = useRecordTimeline(subjectType, subjectId);
  const groups = useMemo(() => groupByDay(timelineQuery.data ?? []), [timelineQuery.data]);

  if (timelineQuery.isLoading) {
    return (
      <div className={`py-10 text-center ${className ?? ""}`}>
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-pink-600" />
        <p className="mt-2 text-xs text-gray-500">Memuat timeline…</p>
      </div>
    );
  }
  if (timelineQuery.isError) {
    if (
      hideOnForbidden &&
      timelineQuery.error instanceof Error &&
      /insufficient permissions/i.test(timelineQuery.error.message)
    ) {
      return null;
    }
    return (
      <div className={`py-10 text-center text-sm text-gray-500 ${className ?? ""}`}>
        {timelineQuery.error instanceof Error ? timelineQuery.error.message : "Gagal memuat timeline"}
        <div>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => timelineQuery.refetch()}>
            Coba lagi
          </Button>
        </div>
      </div>
    );
  }
  if (groups.length === 0) {
    return <p className={`py-10 text-center text-sm text-gray-500 ${className ?? ""}`}>{emptyText}</p>;
  }

  return (
    <div className={`space-y-6 ${className ?? ""}`}>
      {groups.map((group) => (
        <div key={group.day}>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{formatDay(group.day)}</p>
          <ol className="relative space-y-3 border-l border-gray-200 pl-5">
            {group.events.map((event) => (
              <TimelineItem key={event.key} event={event} onCompleteTask={onCompleteTask} />
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

function TimelineItem({
  event,
  onCompleteTask,
}: {
  event: TimelineEvent;
  onCompleteTask?: (taskId: string) => void;
}) {
  const Icon = KIND_ICON[event.kind] ?? FileText;
  const status = typeof event.meta?.status === "string" ? (event.meta.status as string) : null;
  const isOpenTask = event.kind === "task" && (status === "open" || status === "in_progress");
  const taskId = event.key.startsWith("task:") ? event.key.slice(5) : null;
  const title = event.href ? (
    <Link href={event.href} className="font-medium text-gray-900 hover:text-pink-700 hover:underline">
      {event.title}
    </Link>
  ) : (
    <span className="font-medium text-gray-900">{event.title}</span>
  );
  return (
    <li className="relative">
      <span
        className={`absolute -left-[31px] top-0.5 grid h-6 w-6 place-items-center rounded-full ${KIND_COLOR[event.kind]}`}
      >
        {status === "done" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
      </span>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 text-sm">
          {title}
          {event.badge ? (
            <Badge className="ml-2 border-0 bg-gray-100 font-normal text-gray-600">
              {BADGE_LABEL[event.badge] ?? event.badge}
            </Badge>
          ) : null}
          {event.description ? (
            <p className="mt-0.5 whitespace-pre-line text-xs text-gray-600">{event.description}</p>
          ) : null}
          <p className="mt-0.5 text-[11px] text-gray-400">
            {formatTime(event.at, "")}
            {event.actor ? ` · ${event.actor}` : ""}
            {typeof event.meta?.priority === "string" && event.meta.priority !== "normal"
              ? ` · prioritas ${event.meta.priority}`
              : ""}
          </p>
        </div>
        {isOpenTask && onCompleteTask && taskId ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 rounded-md border-emerald-200 px-2 text-xs text-emerald-700 hover:bg-emerald-50"
            onClick={() => onCompleteTask(taskId)}
          >
            Selesai
          </Button>
        ) : null}
      </div>
    </li>
  );
}
