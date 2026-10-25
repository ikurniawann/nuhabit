"use client";

import { Badge } from "@/components/ui/badge";
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  STATUS_VARIANT,
  activeDeadline,
  deadlineText,
  type ComplaintPriority,
  type ComplaintStatus,
  type Ticket,
} from "../api";

const PRIORITY_VARIANT: Record<ComplaintPriority, "muted" | "default" | "warning" | "destructive"> = {
  low: "muted",
  normal: "default",
  high: "warning",
  urgent: "destructive",
};

export function StatusBadge({ status }: { status: ComplaintStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>;
}

export function PriorityBadge({ priority }: { priority: ComplaintPriority }) {
  return <Badge variant={PRIORITY_VARIANT[priority]}>{PRIORITY_LABEL[priority]}</Badge>;
}

/** Sisa waktu ke batas yang sedang berjalan, merah bila lewat. */
export function DeadlineText({ ticket, now }: { ticket: Pick<Ticket, "status" | "first_response_at" | "respond_by" | "resolve_by" | "overdue">; now: Date }) {
  const d = activeDeadline(ticket);
  if (!d) return <span className="text-muted-foreground">-</span>;
  return (
    <span className={ticket.overdue ? "font-medium text-danger" : "text-body"}>
      {d.kind === "respond" ? "Respons" : "Selesai"} {deadlineText(d.at, now)}
    </span>
  );
}
