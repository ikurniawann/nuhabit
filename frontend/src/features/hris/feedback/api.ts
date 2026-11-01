import { apiDelete, apiGet, apiPost, apiPut, buildListUrl } from "@/lib/api-client";
import type {
  FeedbackApprovalFilter,
  FeedbackApprovalsResult,
  FeedbackAssignment,
  FeedbackAssignmentPayload,
  FeedbackCycle,
  FeedbackCyclePayload,
  FeedbackDecision,
  FeedbackSummary,
  MyFeedbackDetail,
  MyFeedbackList,
  MyFeedbackSavePayload,
} from "./types";

const BASE = "/api/hris";
/** Satu siklus jarang melebihi ini; daftar dibaca sekali tanpa paginasi UI. */
const LIST_LIMIT = 500;

export const fetchFeedbackCycles = () =>
  apiGet<{ data: FeedbackCycle[] }>(buildListUrl(`${BASE}/feedback-cycles`, { limit: 100 })).then((res) => res.data);

export const createFeedbackCycle = (payload: FeedbackCyclePayload) =>
  apiPost<{ data: FeedbackCycle }>(`${BASE}/feedback-cycles`, payload);

export const updateFeedbackCycle = (id: string, payload: Partial<FeedbackCyclePayload>) =>
  apiPut<{ data: FeedbackCycle }>(`${BASE}/feedback-cycles/${id}`, payload);

export const deleteFeedbackCycle = (id: string) => apiDelete(`${BASE}/feedback-cycles/${id}`);

export const fetchFeedbackAssignments = (cycleId: string) =>
  apiGet<{ data: FeedbackAssignment[] }>(
    buildListUrl(`${BASE}/feedback-assignments`, { cycle_id: cycleId, limit: LIST_LIMIT })
  ).then((res) => res.data);

export const createFeedbackAssignments = (rows: FeedbackAssignmentPayload[]) =>
  apiPost<{ data: FeedbackAssignment[] }>(`${BASE}/feedback-assignments`, rows);

export const deleteFeedbackAssignment = (id: string) => apiDelete(`${BASE}/feedback-assignments/${id}`);

export const fetchFeedbackApprovals = (status: FeedbackApprovalFilter) =>
  apiGet<FeedbackApprovalsResult>(buildListUrl(`${BASE}/feedback-approvals`, { status, limit: 100 }));

export const decideFeedback = (decision: FeedbackDecision) =>
  apiPost<{ message?: string }>(`${BASE}/feedback-approvals`, decision);

export const fetchFeedbackSummaries = (cycleId: string) =>
  apiGet<{ data: FeedbackSummary[] }>(
    buildListUrl(`${BASE}/feedback-summaries`, { cycle_id: cycleId, limit: LIST_LIMIT })
  ).then((res) => res.data);

// ── ESS: penilaian yang ditugaskan ke saya ──
const ME = `${BASE}/me/feedback-360`;

export const fetchMyFeedback = () => apiGet<MyFeedbackList>(ME);

export const fetchMyFeedbackDetail = (id: string) =>
  apiGet<{ data: MyFeedbackDetail }>(`${ME}/${id}`).then((res) => res.data);

export const saveMyFeedback = (id: string, payload: MyFeedbackSavePayload) =>
  apiPut<{ message?: string; data: { id: string; status: string } }>(`${ME}/${id}`, payload);
