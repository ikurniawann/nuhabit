/**
 * Tipe API to-do Task Departemen (Go: backend/internal/modules/payroll,
 * depttasks_*.go). Satu baris = satu kemunculan (jadwal) task.
 */

export type TaskRecurrence = "once" | "daily" | "weekly" | "monthly";
export type TaskPriority = "low" | "normal" | "high" | "urgent";
/** pending → in_progress → done (tunggu review) → approved | rejected. */
export type OccurrenceStatus = "pending" | "in_progress" | "done" | "approved" | "rejected";
export type TaskView = "today" | "week" | "month" | "all";

export interface TaskItem {
  occurrence_id: string;
  task_id: string;
  title: string;
  description: string;
  department_id: string;
  department_name: string;
  assignee_employee_id: string | null;
  assignee_name: string | null;
  created_by_user_id: string | null;
  created_by_name: string;
  /** YYYY-MM-DD dalam zona task. */
  occurrence_date: string;
  status: OccurrenceStatus;
  progress_percent: number | null;
  started_at: string | null;
  done_at: string | null;
  done_by_name: string | null;
  review_notes: string | null;
  reviewed_by_name: string | null;
  recurrence: TaskRecurrence;
  priority: TaskPriority;
  /** false untuk task pribadi: "selesai" langsung final. */
  review_required: boolean;
  timezone: string;
  kpi_indicator_id: string | null;
  kpi_indicator_code: string | null;
  kpi_indicator_name: string | null;
  kpi_contribution: number | null;
  subtask_count: number;
  comment_count: number;
  attachment_count: number;
  last_note: string | null;
  last_note_by: string | null;
  last_note_at: string | null;
  /** Progres efektif 0–100. */
  progress: number;
  overdue: boolean;
  mine: boolean;
  can_work: boolean;
  can_review: boolean;
  can_manage: boolean;
}

export interface SubtaskItem {
  id: string;
  title: string;
  weight: number;
  sort_order: number;
  is_checked: boolean;
  checked_by_name: string | null;
  checked_at: string | null;
}

export type UpdateKind = "progress" | "comment" | "status" | "review" | "attachment" | "created";

export interface TaskUpdate {
  id: string;
  kind: UpdateKind;
  note: string | null;
  progress_percent: number | null;
  author_name: string | null;
  author_user_id: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface TaskAttachment {
  id: string;
  name: string;
  mime: string;
  size_bytes: number;
  uploaded_by_user_id: string | null;
  uploaded_by_name: string;
  created_at: string;
}

export interface TaskDetail extends TaskItem {
  subtasks: SubtaskItem[];
  updates: TaskUpdate[];
  attachments: TaskAttachment[];
  contribution: {
    indicator_id: string;
    period_year: number;
    period_month: number;
    amount: number | null;
    recorded_at: string;
  } | null;
  weekly_day: number | null;
  monthly_day: number | null;
  due_date: string | null;
}

export interface TaskMeta {
  me: {
    user_id: string;
    name: string;
    employee_id: string | null;
    department_id: string | null;
    has_subordinates: boolean;
    is_hr: boolean;
    team_all: boolean;
    kpi_all: boolean;
    timezone: string;
  };
  team_scope: "all" | "heads" | "none";
  departments: { id: string; name: string }[];
  members: { id: string; full_name: string; department_id: string }[];
  indicators: {
    id: string;
    code: string;
    name: string;
    unit: string | null;
    direction: string;
    department_ids: string[];
  }[];
  /** YYYY-MM-DD hari ini dalam zona cabang pembaca. */
  today: string;
}

/** Body POST /api/hris/dept-tasks. */
export interface CreateTaskPayload {
  title: string;
  description?: string | null;
  department_id?: string;
  assignee_employee_id?: string | null;
  recurrence: TaskRecurrence;
  weekly_day?: number | null;
  monthly_day?: number | null;
  due_date?: string | null;
  priority?: TaskPriority;
  kpi_indicator_id?: string | null;
  kpi_contribution?: number | null;
  subtasks?: { title: string }[];
}

/** Body PATCH /api/hris/dept-tasks/{id}; tanpa field berarti nonaktifkan. */
export interface TaskPatch {
  title?: string;
  description?: string | null;
  priority?: TaskPriority;
  assignee_employee_id?: string | null;
  kpi_indicator_id?: string | null;
  kpi_contribution?: number | null;
  is_active?: boolean;
}

export type OccurrenceAction =
  | { action: "done" | "approve" | "start" }
  | { action: "reject"; notes: string | null }
  | { action: "reopen"; note?: string | null }
  | { action: "comment"; note: string }
  | { action: "progress"; note?: string | null; progress_percent?: number | null }
  | { action: "check_subtask"; subtask_id: string; checked: boolean };

export interface TaskListFilter {
  scope?: "mine" | "team";
  view?: TaskView;
  month?: string;
  department_id?: string;
  assignee_employee_id?: string;
  status?: OccurrenceStatus;
  kpi_indicator_id?: string;
  q?: string;
}

export interface IndicatorTasks {
  indicator_id: string;
  code: string;
  name: string;
  unit: string | null;
  direction: string;
  weight: number | null;
  total: number;
  approved: number;
  waiting_review: number;
  open: number;
  overdue: number;
  rate: number | null;
  expected_total: number;
  contribution_total: number;
  tasks: TaskItem[];
}

export interface KpiTasksView {
  department_id: string;
  month: string;
  indicators: IndicatorTasks[];
}

export interface ContributionSummary {
  indicator_id: string;
  code: string;
  tasks_total: number;
  tasks_done: number;
  contribution_total: number;
}

export interface MonitorSummary {
  scheduled: number;
  due: number;
  approved: number;
  waiting_review: number;
  in_progress: number;
  not_started: number;
  rejected: number;
  overdue: number;
  completion: number | null;
  avg_progress: number | null;
}

export interface MonitorRow {
  occurrence_id: string;
  task_id: string;
  title: string;
  department_id: string;
  department_name: string;
  assignee_id: string | null;
  assignee_name: string | null;
  occurrence_date: string;
  status: OccurrenceStatus;
  progress: number;
  last_note: string | null;
  last_note_at: string | null;
}

export interface AssigneeSummary extends MonitorSummary {
  assignee_id: string | null;
  assignee_name: string;
}

export interface DepartmentSummary extends MonitorSummary {
  department_id: string;
  department_name: string;
  assignees: AssigneeSummary[];
}

export interface MonitorData {
  start: string;
  end: string;
  today: string;
  summary: MonitorSummary;
  departments: DepartmentSummary[];
  overdue: MonitorRow[];
  waiting_review: MonitorRow[];
  is_hr: boolean;
  scope: "all" | "own";
}

export const STATUS_LABEL: Record<OccurrenceStatus, string> = {
  pending: "Belum dimulai",
  in_progress: "Dikerjakan",
  done: "Tunggu review",
  approved: "Disetujui",
  rejected: "Ditolak",
};

export const STATUS_ORDER: OccurrenceStatus[] = ["pending", "in_progress", "done", "approved", "rejected"];

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: "Rendah",
  normal: "Normal",
  high: "Tinggi",
  urgent: "Mendesak",
};

export const RECURRENCE_LABEL: Record<TaskRecurrence, string> = {
  once: "Sekali",
  daily: "Harian",
  weekly: "Mingguan",
  monthly: "Bulanan",
};

export const DAY_NAMES_ID = ["", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];

/** Masih menunggu pekerjaan: belum mulai, dikerjakan, atau ditolak. */
export const isOpenStatus = (s: OccurrenceStatus) => s === "pending" || s === "in_progress" || s === "rejected";
