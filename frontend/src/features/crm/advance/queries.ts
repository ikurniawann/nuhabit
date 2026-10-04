"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as api from "./api";
import type { ApprovalRuleInput, CustomFieldInput, ScoringRuleInput } from "./types";

const K = {
  scoring: ["crm", "advance", "scoring-rules"] as const,
  workflows: ["crm", "advance", "workflow-rules"] as const,
  runs: (id: string) => ["crm", "advance", "workflow-runs", id] as const,
  approvalRules: ["crm", "advance", "approval-rules"] as const,
  approvals: (view: string, status: string) => ["crm", "advance", "approvals", view, status] as const,
  owners: ["sales-funnel", "owners"] as const,
  customFields: ["crm", "advance", "custom-fields"] as const,
  forecast: (month: string, pipelineId: string) => ["sales-funnel", "forecast", month, pipelineId] as const,
  targets: (month: string) => ["sales-funnel", "targets", month] as const,
};

function mutation<TArgs>(fn: (args: TArgs) => Promise<unknown>, keys: readonly (readonly string[])[], okMessage: string, onSuccess?: () => void) {
  return function useIt() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: fn,
      onSuccess: (body) => {
        const msg = (body as { message?: string } | undefined)?.message;
        toast.success(msg ?? okMessage);
        for (const k of keys) qc.invalidateQueries({ queryKey: k });
        onSuccess?.();
      },
      onError: (e: Error) => toast.error(e.message),
    });
  };
}

export const useScoringRules = () => useQuery({ queryKey: K.scoring, queryFn: api.fetchScoringRules });
export const useCreateScoringRule = mutation((v: ScoringRuleInput) => api.createScoringRule(v), [K.scoring], "Aturan dibuat");
export const useUpdateScoringRule = mutation(({ id, values }: { id: string; values: Partial<ScoringRuleInput> }) => api.updateScoringRule(id, values), [K.scoring], "Aturan diperbarui");
export const useDeleteScoringRule = mutation((id: string) => api.deleteScoringRule(id), [K.scoring], "Aturan dihapus");
export const useRecalculateScores = mutation(() => api.recalculateScores(), [["sales-funnel", "leads"]], "Skor dihitung ulang");

export const useWorkflowRules = () => useQuery({ queryKey: K.workflows, queryFn: api.fetchWorkflowRules });
export const useWorkflowRuns = (id: string, enabled: boolean) => useQuery({ queryKey: K.runs(id), queryFn: () => api.fetchWorkflowRuns(id), enabled });
export const useCreateWorkflowRule = mutation((v: unknown) => api.createWorkflowRule(v), [K.workflows], "Rule dibuat");
export const useUpdateWorkflowRule = mutation(({ id, values }: { id: string; values: unknown }) => api.updateWorkflowRule(id, values), [K.workflows], "Rule diperbarui");
export const useDeleteWorkflowRule = mutation((id: string) => api.deleteWorkflowRule(id), [K.workflows], "Rule dihapus");

export const useApprovalRules = () => useQuery({ queryKey: K.approvalRules, queryFn: api.fetchApprovalRules });
export const useCreateApprovalRule = mutation((v: ApprovalRuleInput) => api.createApprovalRule(v), [K.approvalRules], "Aturan dibuat");
export const useUpdateApprovalRule = mutation(({ id, values }: { id: string; values: Partial<ApprovalRuleInput> }) => api.updateApprovalRule(id, values), [K.approvalRules], "Aturan diperbarui");
export const useDeleteApprovalRule = mutation((id: string) => api.deleteApprovalRule(id), [K.approvalRules], "Aturan dihapus");

export const useApprovals = (view: "mine" | "all", status: string) =>
  useQuery({ queryKey: K.approvals(view, status), queryFn: () => api.fetchApprovals(view, status), refetchInterval: 60_000 });
export const useDecideApproval = mutation(
  ({ id, decision, comment }: { id: string; decision: "approve" | "reject"; comment: string }) => api.decideApprovalRequest(id, decision, comment),
  [["crm", "advance", "approvals"], ["sales-funnel", "quotations"]],
  "Keputusan tersimpan"
);

export const useOwners = () => useQuery({ queryKey: K.owners, queryFn: api.fetchOwners, staleTime: 5 * 60_000 });

export const useCustomFields = () => useQuery({ queryKey: K.customFields, queryFn: api.fetchCustomFields });
export const useCreateCustomField = mutation((v: CustomFieldInput) => api.createCustomField(v), [K.customFields, ["crm", "custom-fields"]], "Field dibuat");
export const useUpdateCustomField = mutation(({ id, values }: { id: string; values: Partial<CustomFieldInput> }) => api.updateCustomField(id, values), [K.customFields, ["crm", "custom-fields"]], "Field diperbarui");
export const useDeleteCustomField = mutation((id: string) => api.deleteCustomField(id), [K.customFields, ["crm", "custom-fields"]], "Field dihapus");

export const useForecast = (month: string, pipelineId = "") =>
  useQuery({ queryKey: K.forecast(month, pipelineId), queryFn: () => api.fetchForecast(month, pipelineId || undefined) });
export const useTargets = (month: string) => useQuery({ queryKey: K.targets(month), queryFn: () => api.fetchTargets(month) });
export const useSaveTargets = mutation(
  (targets: Array<{ user_id: string | null; period_month: string; target_value: number; target_deals?: number | null }>) => api.saveTargets(targets),
  [["sales-funnel", "targets"], ["sales-funnel", "forecast"]],
  "Target disimpan"
);
