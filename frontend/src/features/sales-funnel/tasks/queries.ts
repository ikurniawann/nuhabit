"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createTask, deleteTask, fetchTasks, updateTask } from "./api";
import type { TaskFilters, TaskFormValues, TaskSubjectRef } from "./types";
import { formToPayload } from "./types";

export const taskQueryKeys = {
  all: ["sales-funnel", "activities"] as const, // sama dengan activities → saling invalidasi
  list: (filters: TaskFilters) => ["sales-funnel", "activities", "tasks", filters] as const,
};

const TIMELINE_KEY = ["sales-funnel", "timeline"] as const;

export const useTasks = (filters: TaskFilters, enabled = true) =>
  useQuery({
    queryKey: taskQueryKeys.list(filters),
    queryFn: () => fetchTasks(filters),
    enabled,
  });

export function useCreateTask(onSuccess?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ subject, values }: { subject: TaskSubjectRef; values: TaskFormValues }) =>
      createTask(subject, values),
    onSuccess: () => {
      toast.success("Task dibuat");
      queryClient.invalidateQueries({ queryKey: taskQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: TIMELINE_KEY });
      onSuccess?.();
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useUpdateTask(onSuccess?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      values,
    }: {
      id: string;
      values: Partial<ReturnType<typeof formToPayload>> & { is_done?: boolean };
    }) => updateTask(id, values),
    onSuccess: (body) => {
      if (body?.message) toast.success(body.message);
      queryClient.invalidateQueries({ queryKey: taskQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: TIMELINE_KEY });
      onSuccess?.();
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteTask(id),
    onSuccess: () => {
      toast.success("Task dihapus");
      queryClient.invalidateQueries({ queryKey: taskQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: TIMELINE_KEY });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}
