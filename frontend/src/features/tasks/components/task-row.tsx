"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useOccurrenceAction } from "../mutations";
import type { TaskItem } from "../types";
import { PriorityBadge, StatusBadge, TaskMetaLine } from "./task-badges";

/**
 * Satu baris: centang untuk menandai selesai (tugas pribadi langsung
 * final, tugas departemen menunggu review), klik judul untuk detail.
 */
export function TaskRow({ item, onOpen, showAssignee = false }: { item: TaskItem; onOpen: (id: string) => void; showAssignee?: boolean }) {
  const act = useOccurrenceAction();
  const closed = item.status === "approved" || item.status === "done";
  const canTick = item.can_work && item.subtask_count === 0;
  return (
    <li className={cn("flex items-start gap-3 px-4 py-3", item.status === "approved" && "opacity-60")}>
      <Checkbox
        aria-label={closed ? `Buka lagi ${item.title}` : `Selesaikan ${item.title}`}
        checked={closed}
        disabled={act.isPending || !canTick || (item.status === "approved" && item.review_required && !item.can_review)}
        onCheckedChange={(checked) =>
          act.mutate({ id: item.occurrence_id, body: checked ? { action: "done" } : { action: "reopen" } })
        }
        className="mt-1"
      />
      <button
        type="button"
        onClick={() => onOpen(item.occurrence_id)}
        className="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-forest/40"
      >
        <span className={cn("flex flex-wrap items-center gap-2 text-sm font-medium text-foreground", item.status === "approved" && "line-through")}>
          {item.title}
          <PriorityBadge priority={item.priority} />
          {item.status !== "pending" && !item.overdue && <StatusBadge status={item.status} />}
        </span>
        <TaskMetaLine item={item} showAssignee={showAssignee} />
      </button>
    </li>
  );
}
