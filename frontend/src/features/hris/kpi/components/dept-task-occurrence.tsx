"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import {
  checkedKey,
  isOverdue,
  subtaskProgress,
  type CheckedIndex,
} from "@/lib/kpi/ui-dept-tasks";
import type { DeptOccurrenceRow, DeptSubtaskRow } from "../types";
import { OCCURRENCE_STATUS_META } from "./dept-task-meta";

interface DeptTaskOccurrenceProps {
  occ: DeptOccurrenceRow;
  subtasks: DeptSubtaskRow[];
  checked: CheckedIndex;
  todayIso: string;
  expanded: boolean;
  canReview: boolean;
  /** Id kemunculan yang sedang diproses (satu aksi sekaligus). */
  busyId: string | null;
  onToggleExpand: () => void;
  onAction: (action: "done" | "approve" | "reject") => void;
  onToggleSubtask: (subtaskId: string, checked: boolean) => void;
}

/** Satu jadwal (kemunculan) task: status, aksi, dan kartu sub-task. */
export function DeptTaskOccurrence({
  occ,
  subtasks,
  checked,
  todayIso,
  expanded,
  canReview,
  busyId,
  onToggleExpand,
  onAction,
  onToggleSubtask,
}: DeptTaskOccurrenceProps) {
  const meta = OCCURRENCE_STATUS_META[occ.status];
  const canMarkDone = occ.status === "pending" || occ.status === "rejected";
  const busy = busyId === occ.id;
  const progress = subtaskProgress(occ.id, subtasks, checked);

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="w-24 pl-6 text-xs tabular-nums text-gray-600">
        {occ.occurrence_date.slice(8, 10)}/{occ.occurrence_date.slice(5, 7)}
        {occ.occurrence_date === todayIso ? (
          <span className="ml-1 font-semibold text-brand-text">hari ini</span>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-gray-500">
          {occ.done_by_name ? `diselesaikan ${occ.done_by_name}` : ""}
          {occ.status === "rejected" && occ.review_notes ? ` · alasan: ${occ.review_notes}` : ""}
        </p>
      </div>
      {subtasks.length > 0 ? (
        <button
          type="button"
          className="text-xs font-semibold tabular-nums text-brand-text hover:underline"
          onClick={onToggleExpand}
          title="Lihat sub-task"
        >
          {Math.round(progress)}%
        </button>
      ) : null}
      <Badge className={meta.cls}>{isOverdue(occ, todayIso) ? "Lewat tempo" : meta.label}</Badge>
      <div className="flex gap-1.5">
        {canMarkDone && subtasks.length === 0 ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction("done")}>
            Tandai Selesai
          </Button>
        ) : null}
        {canMarkDone && subtasks.length > 0 ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={onToggleExpand}>
            {expanded ? "Tutup" : "Kerjakan"}
          </Button>
        ) : null}
        {canReview && occ.status === "done" ? (
          <>
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700"
              disabled={busy}
              onClick={() => onAction("approve")}
            >
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Setujui
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-red-200 text-red-600"
              disabled={busy}
              onClick={() => onAction("reject")}
            >
              <XCircle className="mr-1 h-3.5 w-3.5" /> Tolak
            </Button>
          </>
        ) : null}
      </div>
      {expanded && subtasks.length > 0 ? (
        <div className="grid w-full grid-cols-1 gap-2 rounded-lg bg-muted/40 p-3 sm:grid-cols-2 lg:grid-cols-3">
          {subtasks.map((st) => {
            const info = checked.get(checkedKey(occ.id, st.id));
            const isChecked = Boolean(info);
            const canCheck = occ.status !== "approved" && busyId === null;
            return (
              // Kartu sentuh (owner 2026-08-31): dipakai dari HP/tablet,
              // seluruh kartu adalah area tap.
              <button
                key={st.id}
                type="button"
                disabled={!canCheck}
                onClick={() => onToggleSubtask(st.id, !isChecked)}
                className={`flex min-h-[64px] items-center gap-3 rounded-xl border-2 p-3 text-left transition-colors ${
                  isChecked
                    ? "border-emerald-300 bg-emerald-50"
                    : "border-gray-200 bg-white active:bg-gray-50"
                } ${canCheck ? "" : "opacity-70"}`}
              >
                <span
                  className={`flex h-7 w-7 flex-none items-center justify-center rounded-full border-2 ${
                    isChecked
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : "border-gray-300 text-transparent"
                  }`}
                >
                  ✓
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block text-sm font-medium ${isChecked ? "text-emerald-800" : "text-gray-800"}`}
                  >
                    {st.title}
                  </span>
                  {info?.name ? (
                    <span className="block truncate text-xs text-emerald-600">
                      {info.name}
                      {info.at ? ` · ${formatDateTime(info.at)}` : ""}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
