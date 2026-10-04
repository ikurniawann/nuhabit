import type {
  Recurrence,
  ReminderChannel,
  TaskPriority,
  TaskStatus,
  TaskSubjectType,
} from "@/lib/sales-funnel/tasks";

export type { Recurrence, ReminderChannel, TaskPriority, TaskStatus, TaskSubjectType };

export type TaskActivityType = "telepon" | "wa" | "meeting" | "catatan" | "tugas" | "email";

export interface SalesTask {
  id: string;
  lead_id: string | null;
  deal_id: string | null;
  subject_type: TaskSubjectType | null;
  subject_id: string | null;
  subject_name: string | null;
  activity_type: TaskActivityType;
  title: string | null;
  notes: string | null;
  due_at: string | null;
  done_at: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  recurrence: Recurrence | null;
  reminder_at: string | null;
  reminder_channels: ReminderChannel[] | null;
  parent_task_id: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  reminder_sent_at: string | null;
  created_at: string;
  deal_title: string | null;
  org_name: string | null;
  pic_name: string | null;
  pic_phone: string | null;
}

export type TaskView = "today" | "upcoming" | "range" | "all";

export interface TaskFilters {
  view?: TaskView;
  from?: string; // YYYY-MM-DD (view=range)
  to?: string;
  status?: TaskStatus | "open_all" | "";
  priority?: TaskPriority | "";
  owner_user_id?: string;
  subject_type?: TaskSubjectType;
  subject_id?: string;
}

export interface TaskFormValues {
  title: string;
  activity_type: TaskActivityType;
  notes: string;
  due_at: string; // datetime-local
  reminder_at: string; // datetime-local, "" = sama dengan due
  reminder_channels: ReminderChannel[];
  priority: TaskPriority;
  status: TaskStatus;
  recurrence_freq: "" | Recurrence["freq"];
  recurrence_interval: number;
  recurrence_until: string; // YYYY-MM-DD
  owner_user_id: string;
}

export interface TaskSubjectRef {
  subject_type: TaskSubjectType;
  subject_id: string;
  label?: string;
}

export const EMPTY_TASK_FORM: TaskFormValues = {
  title: "",
  activity_type: "tugas",
  notes: "",
  due_at: "",
  reminder_at: "",
  reminder_channels: ["wa", "in_app"],
  priority: "normal",
  status: "open",
  recurrence_freq: "",
  recurrence_interval: 1,
  recurrence_until: "",
  owner_user_id: "",
};

export const TASK_TYPE_LABELS: Record<TaskActivityType, string> = {
  tugas: "Task",
  telepon: "Telepon",
  wa: "WhatsApp",
  meeting: "Meeting",
  email: "Email",
  catatan: "Catatan",
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  urgent: "Urgent",
  high: "Tinggi",
  normal: "Normal",
  low: "Rendah",
};

export const PRIORITY_BADGE: Record<TaskPriority, string> = {
  urgent: "border-0 bg-red-100 font-normal text-red-700",
  high: "border-0 bg-orange-100 font-normal text-orange-700",
  normal: "border-0 bg-gray-100 font-normal text-gray-600",
  low: "border-0 bg-sky-100 font-normal text-sky-700",
};

export const STATUS_LABELS: Record<TaskStatus, string> = {
  open: "Terbuka",
  in_progress: "Dikerjakan",
  done: "Selesai",
  cancelled: "Dibatalkan",
};

export const SUBJECT_LABELS: Record<TaskSubjectType, string> = {
  lead: "Lead",
  deal: "Deal",
  account: "Account",
  contact: "Contact",
  member: "Member",
};

export const RECURRENCE_LABELS: Record<Recurrence["freq"], string> = {
  daily: "Harian",
  weekly: "Mingguan",
  monthly: "Bulanan",
};

/** datetime-local (waktu lokal) → ISO string. */
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** ISO → nilai input datetime-local (waktu lokal browser). */
export function isoToLocalInput(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function isOverdue(task: Pick<SalesTask, "due_at" | "status">): boolean {
  if (!task.due_at || task.status === "done" || task.status === "cancelled") return false;
  return new Date(task.due_at).getTime() < Date.now();
}

export function taskToForm(task: SalesTask): TaskFormValues {
  return {
    title: task.title ?? "",
    activity_type: task.activity_type,
    notes: task.notes ?? "",
    due_at: isoToLocalInput(task.due_at),
    reminder_at: task.reminder_at && task.reminder_at !== task.due_at ? isoToLocalInput(task.reminder_at) : "",
    reminder_channels: task.reminder_channels ?? ["wa", "in_app"],
    priority: task.priority,
    status: task.status,
    recurrence_freq: task.recurrence?.freq ?? "",
    recurrence_interval: task.recurrence?.interval ?? 1,
    recurrence_until: task.recurrence?.until ?? "",
    owner_user_id: task.owner_user_id ?? "",
  };
}

/** Bentuk payload API dari form (dipakai create & update). */
export function formToPayload(values: TaskFormValues) {
  const recurrence =
    values.recurrence_freq
      ? {
          freq: values.recurrence_freq,
          interval: Math.max(1, Number(values.recurrence_interval) || 1),
          until: values.recurrence_until || null,
        }
      : null;
  return {
    title: values.title.trim() || null,
    activity_type: values.activity_type,
    notes: values.notes.trim() || null,
    due_at: localInputToIso(values.due_at),
    reminder_at: localInputToIso(values.reminder_at) ?? localInputToIso(values.due_at),
    reminder_channels: values.reminder_channels,
    priority: values.priority,
    status: values.status,
    recurrence,
    owner_user_id: values.owner_user_id || null,
  };
}
