import type { OvertimeDecisionAction } from "@/lib/hris/overtime-rules";

export interface OvertimeRow {
  id: string;
  employee_id: string;
  date: string;
  start_time: string;
  end_time: string;
  hours: string | number;
  source: "employee" | "company";
  status: string;
  reason: string | null;
  rejection_reason: string | null;
  employee?: { id: string; full_name: string; nip: string | null } | null;
  requester?: { full_name: string } | null;
  decider?: { full_name: string } | null;
}

export interface OvertimeFilters {
  status: string;
  /** "YYYY-MM" atau "" */
  month: string;
}

export interface OvertimeDecision {
  overtime_id: string;
  action: OvertimeDecisionAction;
  rejection_reason?: string;
}
