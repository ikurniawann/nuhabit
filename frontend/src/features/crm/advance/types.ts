import type { ScoringRuleInput } from "@/lib/crm/scoring";
import type { WorkflowAction, WorkflowCondition, WorkflowObject, WorkflowTrigger } from "@/lib/crm/workflow";
import type { ApprovalRuleInput } from "@/lib/crm/approvals";

export type { ScoringRuleInput, WorkflowAction, WorkflowCondition, WorkflowObject, WorkflowTrigger, ApprovalRuleInput };

export interface ScoringRuleRow extends ScoringRuleInput {
  id: string;
  company_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkflowRuleRow {
  id: string;
  company_id: string | null;
  name: string;
  description: string | null;
  object: WorkflowObject;
  trigger_type: WorkflowTrigger;
  trigger_config: { days?: number; score?: number; to_stage?: string | null; to_status?: string | null };
  conditions: WorkflowCondition[];
  actions: WorkflowAction[];
  run_once_per_record: boolean;
  is_active: boolean;
  last_run_at: string | null;
  run_count: number;
  created_at: string;
}

export interface WorkflowRunRow {
  id: string;
  subject_type: string;
  subject_id: string;
  status: "success" | "partial" | "failed" | "skipped" | "scheduled";
  actions_result: Array<Record<string, unknown>>;
  error: string | null;
  created_at: string;
}

export interface ApprovalRuleRow extends ApprovalRuleInput {
  id: string;
  company_id: string | null;
  approver_name: string | null;
  created_at: string;
}

export interface ApprovalStep {
  level: number;
  status: "pending" | "approved" | "rejected" | "skipped";
  approver_role: string | null;
  approver_user_id: string | null;
  decided_at: string | null;
  comment: string | null;
  decided_by_name: string | null;
}

export interface ApprovalRequestRow {
  id: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  current_level: number;
  discount_percent: string | number;
  amount: string | number | null;
  note: string | null;
  created_at: string;
  resolved_at: string | null;
  quotation_id: string;
  quote_number: string;
  total: string | number;
  subtotal: string | number;
  discount_nominal: string | number;
  quotation_status: string;
  deal_id: string;
  deal_title: string;
  org_name: string;
  pic_name: string;
  requested_by_name: string | null;
  steps: ApprovalStep[] | null;
  can_decide: boolean;
}

export interface OwnerOption {
  id: string;
  full_name: string;
  role: string;
  company_id: string | null;
}

export const OBJECT_LABELS: Record<WorkflowObject, string> = {
  lead: "Lead",
  deal: "Deal",
  account: "Account",
  contact: "Contact",
  task: "Task",
  quotation: "Quotation",
};

export const TRIGGER_LABELS: Record<WorkflowTrigger, string> = {
  created: "Dibuat",
  updated: "Diubah",
  stage_changed: "Pindah tahap (deal)",
  status_changed: "Status berubah",
  score_reached: "Skor mencapai ambang (lead)",
  inactive_days: "Tidak ada aktivitas N hari",
  due_soon: "Mendekati jatuh tempo / tanggal acara",
};

export const ACTION_LABELS: Record<WorkflowAction["type"], string> = {
  send_wa: "Kirim WhatsApp",
  create_task: "Buat task",
  assign_owner: "Tetapkan penanggung jawab",
  update_field: "Ubah field",
  notify_in_app: "Notifikasi aplikasi",
  webhook: "Panggil webhook",
  wait: "Tunggu (delay)",
};

export const CONDITION_OP_LABELS: Record<WorkflowCondition["op"], string> = {
  eq: "=",
  neq: "≠",
  in: "salah satu dari",
  not_in: "bukan salah satu dari",
  contains: "mengandung",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  is_empty: "kosong",
  not_empty: "terisi",
  changed: "berubah",
  changed_to: "berubah menjadi",
};

/** Field per objek yang umum dipakai kondisi (bebas diketik juga). */
export const CONDITION_FIELDS: Record<WorkflowObject, string[]> = {
  lead: ["source", "org_type", "temperature", "status", "city", "score", "owner_user_id", "pic_email"],
  deal: ["stage_code", "event_type", "value_estimate", "pax_estimate", "owner_user_id", "source", "org_type"],
  account: ["account_type", "industry", "city", "owner_user_id"],
  contact: ["title", "account_id", "owner_user_id"],
  task: ["activity_type", "priority", "status", "owner_user_id"],
  quotation: ["status", "approval_status", "discount_percent", "total"],
};

// ── EPIC-050 Fase 3 ──
import type { CustomFieldDef, CustomFieldInput } from "@/lib/crm/custom-fields";
import type { ForecastRow } from "@/lib/sales-funnel/forecast";
export type { CustomFieldDef, CustomFieldInput, ForecastRow };

export interface CustomFieldRow extends CustomFieldDef {
  company_id: string | null;
  is_active: boolean;
  created_at: string;
}

export interface ForecastDeal {
  id: string;
  title: string;
  org_name: string;
  owner_user_id: string | null;
  owner_name: string | null;
  value: number;
  probability: number;
  category: "pipeline" | "best_case" | "commit" | "closed_won" | "closed_lost";
  stage_name: string;
  event_date: string | null;
  pipeline_id: string | null;
}

export interface ForecastResponse {
  month: string;
  rows: ForecastRow[];
  /** Target perusahaan bulan ini (user_id null); null bila belum diatur. */
  company_target: { target_value: number; target_deals: number | null } | null;
  total: ForecastRow;
  deals: ForecastDeal[];
}

export interface TargetRow {
  id: string;
  /** null = target perusahaan */
  user_id: string | null;
  full_name: string | null;
  period_month: string;
  target_value: string | number;
  target_deals: number | null;
  pipeline_id: string | null;
}
