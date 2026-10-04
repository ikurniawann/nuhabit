"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, buildListUrl } from "@/lib/api-client";

export interface OnboardingTask {
  id: string;
  task_name: string;
  category: string;
  priority: number;
  due_date: string | null;
  completed: boolean;
  completed_at: string | null;
  assigned_to: string | null;
  description: string | null;
}

export interface OnboardingTaskFilter {
  category?: string;
  /** "true" | "false"; kosong = semua */
  completed?: string;
}

const checklistKey = (employeeId: string) => ["hris", "onboarding", "checklist", employeeId] as const;

export function useOnboardingTasks(employeeId: string, filter: OnboardingTaskFilter) {
  return useQuery({
    queryKey: [...checklistKey(employeeId), filter],
    queryFn: () =>
      apiGet<{ data?: OnboardingTask[] }>(
        buildListUrl(`/api/hris/onboarding/${employeeId}`, { ...filter })
      ).then((res) => res.data ?? []),
    enabled: Boolean(employeeId),
  });
}

export function useCompleteOnboardingTask(employeeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) =>
      apiPost<{ data: OnboardingTask }>(`/api/hris/onboarding/${employeeId}`, {
        action: "complete",
        task_id: taskId,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: checklistKey(employeeId) }),
  });
}
