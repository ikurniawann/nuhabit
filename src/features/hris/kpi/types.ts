/** pg numeric datang sebagai string — selalu Number() saat render */
export type PgNumeric = number | string | null;

export interface KpiBreakdownRow {
  code: string;
  weight: number;
  effectiveWeight: number;
  attainment: number | null;
  contribution: number;
}

export interface KpiIndicatorInfo {
  id: string;
  code: string;
  name: string;
  unit: string | null;
  direction: "higher_better" | "lower_better" | "boolean";
}

export interface KpiScorecardRow {
  id: string;
  employee_id: string;
  period_year: number;
  period_month: number;
  role_code: string;
  score: PgNumeric;
  raw_score: PgNumeric;
  used_weight: PgNumeric;
  breakdown: KpiBreakdownRow[];
  status: "draft" | "final";
  reviewed_by: string | null;
  reviewed_at: string | null;
  employee?: {
    id: string;
    full_name: string;
    nip: string;
    department_id: string | null;
    department?: { name: string } | null;
  } | null;
}

export interface KpiScorecardsResult {
  data: KpiScorecardRow[];
  indicators: KpiIndicatorInfo[];
  period_year?: number;
  period_month?: number;
}

export interface SnapshotSummaryResult {
  period_year: number;
  period_month: number;
  employees: number;
  snapshots_upserted: number;
  scorecards_upserted: number;
  scorecards_skipped_final: number;
  collectors: Record<string, number>;
}

export interface SaveRubricPayload {
  employee_id: string;
  period_month: number;
  period_year: number;
  value: number;
  notes?: string;
}

export interface KpiTargetRowUI {
  id: string;
  indicator_id: string;
  period_year: number | null;
  period_month: number | null;
  role_code: string | null;
  department_id: string | null;
  employee_id: string | null;
  target: PgNumeric;
  indicator?: { code: string; name: string; unit: string | null } | null;
  department?: { id: string; name: string } | null;
  employee?: { id: string; full_name: string; nip: string } | null;
}

export interface CreateKpiTargetPayload {
  indicator_id: string;
  target: number;
  period_year?: number | null;
  period_month?: number | null;
  role_code?: string | null;
  department_id?: string | null;
}

// ── Task Departemen (/api/hris/dept-tasks) ──
export type DeptTaskRecurrence = "once" | "daily" | "weekly" | "monthly";
export type DeptOccurrenceStatus = "pending" | "done" | "approved" | "rejected";

export interface DeptTaskRow {
  id: string;
  title: string;
  description: string | null;
  recurrence: DeptTaskRecurrence;
  weekly_day: number | null;
  monthly_day: number | null;
  due_date: string | null;
  assignee_employee_id: string | null;
  assignee_name: string | null;
  created_by_name: string | null;
}

export interface DeptOccurrenceRow {
  id: string;
  task_id: string;
  occurrence_date: string;
  status: DeptOccurrenceStatus;
  done_by_name: string | null;
  review_notes: string | null;
  reviewed_by_name: string | null;
}

export interface DeptSubtaskRow {
  id: string;
  task_id: string;
  title: string;
  weight: number | string;
  sort_order: number;
}

export interface DeptCheckedItemRow {
  occurrence_id: string;
  subtask_id: string;
  is_checked: boolean;
  checked_by_name?: string | null;
  checked_at?: string | null;
}

export interface DeptTasksData {
  department_id: string | null;
  tasks: DeptTaskRow[];
  occurrences: DeptOccurrenceRow[];
  subtasks?: DeptSubtaskRow[];
  checked_items?: DeptCheckedItemRow[];
  members: { id: string; full_name: string }[];
  departments: { id: string; name: string }[];
  can_manage: boolean;
  can_review?: boolean;
  is_hr: boolean;
  my_employee_id?: string | null;
}

export type DeptOccurrenceAction =
  | { action: "done" | "approve" }
  | { action: "reject"; notes: string | null }
  | { action: "check_subtask"; subtask_id: string; checked: boolean };

export interface CreateDeptTaskPayload {
  department_id?: string;
  title: string;
  description: string | null;
  recurrence: DeptTaskRecurrence;
  weekly_day: number | null;
  monthly_day: number | null;
  due_date: string | null;
  assignee_employee_id: string | null;
  subtasks: { title: string }[];
}

// ── Performance Review (/api/hris/performance/*) ──
export interface PerfRealtimeEmployee {
  id: string;
  full_name: string;
  department_name: string | null;
  avg_score: PgNumeric | undefined;
  months: { month: number; score: PgNumeric; status: string }[] | null;
}

export interface PerfRealtimeData {
  employees: PerfRealtimeEmployee[];
  months: number[];
  is_hr: boolean;
  year?: number;
  quarter?: number;
  my_employee_id?: string | null;
}

export interface PerfCycleRow {
  id: string;
  name: string;
  period_year: number;
  period_quarter: number;
  start_date: string;
  end_date: string;
  status: string;
  total_reviews: number;
  final_reviews: number;
  rated_reviews: number;
}

export interface PerfReviewRow {
  id: string;
  employee_id: string;
  full_name: string;
  nip: string | null;
  department_name: string | null;
  status: string;
  category: string | null;
  total_work_result_score: PgNumeric;
  total_behavioral_score: PgNumeric;
  grand_total_score: PgNumeric;
  employee_sign_date: string | null;
  reviewer_sign_date: string | null;
  reviewer_name: string | null;
  rated_items: number;
  total_items: number;
  self_done?: boolean;
}

export interface PerfReviewsData {
  reviews: PerfReviewRow[];
  can_review: boolean;
  my_employee_id?: string | null;
}

export interface PerfReviewItem {
  id: string;
  value_name: string;
  competency: string | null;
  behavioral_standard: string | null;
  score: number | null;
  notes: string | null;
  score_1_description: string | null;
  score_5_description: string | null;
}

export interface PerfReviewDetail {
  review: {
    id: string;
    full_name: string;
    nip: string | null;
    department_name: string | null;
    cycle_name: string;
    status: string;
    category: string | null;
    total_work_result_score: PgNumeric;
    total_behavioral_score: PgNumeric;
    total_project_score: PgNumeric;
    grand_total_score: PgNumeric;
    self_assessment: string | null;
    reviewer_notes: string | null;
    reviewer_name: string | null;
    employee_sign_date: string | null;
    reviewer_sign_date: string | null;
  };
  items: PerfReviewItem[];
  kpi_months: { period_month: number; score: PgNumeric; status: string }[];
  can_rate: boolean;
  can_finalize: boolean;
  is_owner: boolean;
}

export type PerfReviewPatch =
  | { action: "rate_item"; item_id: string; score: number }
  | { action: "self_assessment" | "reviewer_notes"; text: string }
  | { action: "sign" | "finalize" };

// ── Konfigurasi KPI per departemen (/api/hris/kpi-config) ──
export interface KpiConfigData {
  departments: { id: string; name: string }[];
  indicators: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    unit: string | null;
    direction: string;
  }[];
  mappings: {
    department_id: string;
    indicator_id: string;
    weight: number | string;
    updated_by: string | null;
  }[];
}

export interface SaveKpiConfigPayload {
  department_id: string;
  items: { indicator_id: string; enabled: boolean; weight: number }[];
}
