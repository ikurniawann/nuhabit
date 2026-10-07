import type {
  CustomFieldInput,
  CustomFieldRow,
  ForecastResponse,
  TargetRow,
  ApprovalRequestRow,
  ApprovalRuleInput,
  ApprovalRuleRow,
  OwnerOption,
  ScoringRuleInput,
  ScoringRuleRow,
  WorkflowRuleRow,
  WorkflowRunRow,
} from "./types";

async function parseError(res: Response, fallback: string): Promise<never> {
  let message = fallback;
  try {
    const body = (await res.json()) as { error?: string; message?: string; details?: Array<{ message: string }> };
    message = body.error ?? body.message ?? fallback;
    if (body.details?.length) message += `: ${body.details.map((d) => d.message).join("; ")}`;
  } catch {
    // bukan JSON
  }
  throw new Error(message);
}

async function json<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) await parseError(res, fallback);
  const body = (await res.json()) as { data: T; message?: string };
  return body.data;
}

const jsonInit = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

// ── scoring ──
export const fetchScoringRules = () => fetch("/api/crm/scoring-rules").then((r) => json<ScoringRuleRow[]>(r, "Gagal memuat aturan scoring"));
export const createScoringRule = (v: ScoringRuleInput) => fetch("/api/crm/scoring-rules", jsonInit("POST", v)).then((r) => json(r, "Gagal membuat aturan"));
export const updateScoringRule = (id: string, v: Partial<ScoringRuleInput>) => fetch(`/api/crm/scoring-rules/${id}`, jsonInit("PATCH", v)).then((r) => json(r, "Gagal memperbarui aturan"));
export const deleteScoringRule = async (id: string) => { const r = await fetch(`/api/crm/scoring-rules/${id}`, { method: "DELETE" }); if (!r.ok && r.status !== 204) await parseError(r, "Gagal menghapus aturan"); };
export const recalculateScores = async () => { const r = await fetch("/api/crm/scoring/recalculate", { method: "POST" }); if (!r.ok) await parseError(r, "Gagal menghitung ulang"); return (await r.json()) as { message?: string; data: { total: number; changed: number } }; };

// ── workflow ──
export const fetchWorkflowRules = () => fetch("/api/crm/workflow-rules").then((r) => json<WorkflowRuleRow[]>(r, "Gagal memuat workflow rules"));
export const createWorkflowRule = (v: unknown) => fetch("/api/crm/workflow-rules", jsonInit("POST", v)).then((r) => json(r, "Gagal membuat rule"));
export const updateWorkflowRule = (id: string, v: unknown) => fetch(`/api/crm/workflow-rules/${id}`, jsonInit("PATCH", v)).then((r) => json(r, "Gagal memperbarui rule"));
export const deleteWorkflowRule = async (id: string) => { const r = await fetch(`/api/crm/workflow-rules/${id}`, { method: "DELETE" }); if (!r.ok && r.status !== 204) await parseError(r, "Gagal menghapus rule"); };
export const fetchWorkflowRuns = (id: string) => fetch(`/api/crm/workflow-rules/${id}/runs`).then((r) => json<{ runs: WorkflowRunRow[]; scheduled: Array<Record<string, unknown>> }>(r, "Gagal memuat log"));

// ── approval rules & inbox ──
export const fetchApprovalRules = () => fetch("/api/crm/approval-rules").then((r) => json<ApprovalRuleRow[]>(r, "Gagal memuat aturan approval"));
export const createApprovalRule = (v: ApprovalRuleInput) => fetch("/api/crm/approval-rules", jsonInit("POST", v)).then((r) => json(r, "Gagal membuat aturan"));
export const updateApprovalRule = (id: string, v: Partial<ApprovalRuleInput>) => fetch(`/api/crm/approval-rules/${id}`, jsonInit("PATCH", v)).then((r) => json(r, "Gagal memperbarui aturan"));
export const deleteApprovalRule = async (id: string) => { const r = await fetch(`/api/crm/approval-rules/${id}`, { method: "DELETE" }); if (!r.ok && r.status !== 204) await parseError(r, "Gagal menghapus aturan"); };
export const fetchApprovals = (view: "mine" | "all", status: string) =>
  fetch(`/api/crm/approvals?view=${view}&status=${status}`).then((r) => json<ApprovalRequestRow[]>(r, "Gagal memuat approval"));
export const decideApprovalRequest = async (id: string, decision: "approve" | "reject", comment: string) => {
  const r = await fetch(`/api/crm/approvals/${id}/decide`, jsonInit("POST", { decision, comment: comment || null }));
  if (!r.ok) await parseError(r, "Gagal memutuskan");
  return (await r.json()) as { message?: string };
};

// ── owners ──
export const fetchOwners = () => fetch("/api/sales-funnel/owners").then((r) => json<OwnerOption[]>(r, "Gagal memuat daftar user"));

// ── custom fields (registry) ──
export const fetchCustomFields = () => fetch("/api/crm/custom-fields").then((r) => json<CustomFieldRow[]>(r, "Gagal memuat custom fields"));
export const createCustomField = (v: CustomFieldInput) => fetch("/api/crm/custom-fields", jsonInit("POST", v)).then((r) => json(r, "Gagal membuat field"));
export const updateCustomField = (id: string, v: Partial<CustomFieldInput>) => fetch(`/api/crm/custom-fields/${id}`, jsonInit("PATCH", v)).then((r) => json(r, "Gagal memperbarui field"));
export const deleteCustomField = async (id: string) => { const r = await fetch(`/api/crm/custom-fields/${id}`, { method: "DELETE" }); if (!r.ok && r.status !== 204) await parseError(r, "Gagal menghapus field"); };

// ── forecast & target ──
export const fetchForecast = (month: string, pipelineId?: string) =>
  fetch(`/api/sales-funnel/forecast?month=${month}${pipelineId ? `&pipeline_id=${pipelineId}` : ""}`).then((r) => json<ForecastResponse>(r, "Gagal memuat forecast"));
export const fetchTargets = (month: string) => fetch(`/api/sales-funnel/targets?month=${month}`).then((r) => json<TargetRow[]>(r, "Gagal memuat target"));
export const saveTargets = (targets: Array<{ user_id: string | null; period_month: string; target_value: number; target_deals?: number | null }>) =>
  fetch("/api/sales-funnel/targets", jsonInit("PUT", { targets })).then(async (r) => { if (!r.ok) await parseError(r, "Gagal menyimpan target"); return (await r.json()) as { message?: string }; });
