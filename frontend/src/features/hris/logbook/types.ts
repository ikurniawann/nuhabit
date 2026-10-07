export type LogbookDepartment = { id: string; name: string; code: string };

export type LogbookCurrentUser = {
  id: string;
  full_name: string;
  role: string;
  /** Boleh Review/Reject (dihitung server dari LOGBOOK_REVIEW_ROLES) */
  can_review: boolean;
  /** Boleh lihat/mengelola semua department (dihitung server) */
  is_full_access: boolean;
  employee?: {
    department_id: string | null;
    department?: LogbookDepartment | null;
  } | null;
};

export type LogbookTemplateItem = {
  id?: string;
  title: string;
  description?: string | null;
  weight: number;
  is_required: boolean;
  sort_order?: number;
};

export type LogbookTemplate = {
  id: string;
  department_id: string;
  name: string;
  description?: string | null;
  frequency: string;
  is_active: boolean;
  department?: LogbookDepartment;
  items?: LogbookTemplateItem[];
};

export type LogbookEntryItem = {
  id: string;
  title: string;
  description?: string | null;
  weight: number;
  is_required: boolean;
  is_checked: boolean;
  notes?: string | null;
  sort_order: number;
};

export type LogbookEntry = {
  id: string;
  title: string;
  entry_date: string;
  status: string;
  completion_percentage: number;
  kpi_score: number;
  notes?: string | null;
  review_notes?: string | null;
  department_id: string;
  department?: LogbookDepartment;
  template?: LogbookTemplate;
  items?: LogbookEntryItem[];
};

export type LogbookSummaryRow = {
  department?: LogbookDepartment;
  total_entries: number;
  submitted_entries: number;
  reviewed_entries: number;
  avg_completion: number;
  avg_kpi_score: number;
};

export interface LogbookEntriesParams {
  department_id?: string;
  status?: string;
  date?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export interface LogbookEntriesResult {
  data: LogbookEntry[];
  count: number;
  page: number;
  limit: number;
}

export interface LogbookTemplatesParams {
  department_id?: string;
  include_inactive?: boolean;
}

export interface CreateLogbookTemplatePayload {
  department_id: string;
  name: string;
  description: string;
  frequency: string;
  items: LogbookTemplateItem[];
}

export interface CreateLogbookEntryPayload {
  template_id: string;
  entry_date: string;
}

export interface UpdateLogbookItemPayload {
  item_id: string;
  is_checked?: boolean;
  notes?: string;
}

export interface UpdateLogbookEntryStatusPayload {
  action: "submit-entry" | "review-entry";
  entry_id: string;
  status?: "reviewed" | "rejected";
  review_notes?: string;
}
