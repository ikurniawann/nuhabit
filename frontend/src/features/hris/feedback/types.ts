/** Bentuk respons /api/hris/feedback-* dan /api/hris/me/feedback-360 (Go, modul payroll). */

/** pg numeric dikirim sebagai string ("70.00"). */
export type PgNumeric = string | number | null;

export type FeedbackCycleStatus = "draft" | "active" | "closed";
export type FeedbackAssignmentStatus = "pending" | "in_progress" | "submitted" | "approved" | "rejected";
export type FeedbackRelationship = "self" | "manager" | "peer" | "subordinate" | "external";

export interface FeedbackPerson {
  id: string;
  full_name: string;
  nip?: string | null;
  department?: { name: string | null } | null;
  position?: { title: string | null } | null;
}

export interface FeedbackCycle {
  id: string;
  name: string;
  period_label: string;
  start_date: string;
  end_date: string;
  status: string | null;
  kpi_weight: PgNumeric;
  feedback_weight: PgNumeric;
  is_anonymous: boolean | null;
  allow_self_assessment: boolean | null;
  require_manager_review: boolean | null;
  created_by: { id: string; full_name: string } | null;
  assignments_count: { count: number }[];
  summaries_count: { count: number }[];
  completed_count: number;
}

export interface FeedbackCyclePayload {
  name: string;
  period_label: string;
  start_date: string;
  end_date: string;
  status: FeedbackCycleStatus;
  kpi_weight: number;
  feedback_weight: number;
  is_anonymous: boolean;
  allow_self_assessment: boolean;
  require_manager_review: boolean;
}

export interface FeedbackAssignment {
  id: string;
  cycle_id: string;
  employee_id: string;
  reviewer_id: string | null;
  relationship_type: string;
  status: FeedbackAssignmentStatus;
  due_date: string | null;
  submitted_at: string | null;
  employee: FeedbackPerson | null;
  reviewer: FeedbackPerson | null;
}

export interface FeedbackAssignmentPayload {
  cycle_id: string;
  employee_id: string;
  reviewer_id: string;
  relationship_type: FeedbackRelationship;
  due_date: string | null;
}

export interface FeedbackApprovalResponse {
  id: string;
  rating: number;
  comments: string | null;
  criteria: { name: string; category: { name: string } | null } | null;
}

export interface FeedbackApproval extends FeedbackAssignment {
  approved_at: string | null;
  manager_comments: string | null;
  rejection_reason: string | null;
  cycle: { id: string; name: string; period_label: string } | null;
  responses: FeedbackApprovalResponse[];
}

export type FeedbackApprovalFilter = "submitted" | "approved" | "rejected" | "all";

export interface FeedbackApprovalsResult {
  data: FeedbackApproval[];
}

export type FeedbackDecision =
  | { action: "approve"; assignment_ids: string[]; comments?: string }
  | { action: "reject"; assignment_ids: string[]; rejection_reason: string };

export interface FeedbackSummary {
  id: string;
  cycle_id: string;
  employee_id: string;
  leadership_score: PgNumeric;
  communication_score: PgNumeric;
  collaboration_score: PgNumeric;
  accountability_score: PgNumeric;
  problem_solving_score: PgNumeric;
  overall_360_score: PgNumeric;
  kpi_score: PgNumeric;
  final_score: PgNumeric;
  final_grade: string | null;
  is_locked: boolean | null;
  employee: FeedbackPerson | null;
}

export interface FeedbackCriterion {
  id: string;
  name: string;
  description: string | null;
}

export interface FeedbackCategory {
  id: string;
  name: string;
  description: string | null;
  weight: PgNumeric;
  criteria: FeedbackCriterion[];
}

/** Satu penilaian yang ditugaskan ke saya (ESS). */
export interface MyFeedbackItem {
  id: string;
  status: FeedbackAssignmentStatus;
  relationship_type: string;
  due_date: string | null;
  submitted_at: string | null;
  rejection_reason: string | null;
  manager_comments: string | null;
  answered: number;
  employee: FeedbackPerson | null;
  cycle: { id: string; name: string; period_label: string; end_date: string; is_anonymous: boolean | null } | null;
}

export interface MyFeedbackList {
  data: MyFeedbackItem[];
  criteria_total: number;
}

export interface MyFeedbackAnswer {
  criteria_id: string;
  rating: number;
  comments: string | null;
}

export interface MyFeedbackDetail extends MyFeedbackItem {
  editable: boolean;
  categories: FeedbackCategory[];
  responses: MyFeedbackAnswer[];
}

export interface MyFeedbackSavePayload {
  responses: MyFeedbackAnswer[];
  submit: boolean;
}
