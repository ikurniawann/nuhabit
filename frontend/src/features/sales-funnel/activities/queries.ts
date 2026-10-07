"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  createActivity,
  createWaTemplate,
  deleteActivity,
  deleteWaTemplate,
  fetchActivities,
  fetchWaTemplates,
  sendDealWa,
  updateActivity,
  updateWaTemplate,
} from "./api";
import type { ActivityFilters, ActivityFormValues } from "./types";

export const activityQueryKeys = {
  all: ["sales-funnel", "activities"] as const,
  list: (filters: ActivityFilters) =>
    ["sales-funnel", "activities", filters] as const,
  templates: ["sales-funnel", "wa-templates"] as const,
};

export const useActivities = (filters: ActivityFilters, enabled = true) =>
  useQuery({
    queryKey: activityQueryKeys.list(filters),
    queryFn: () => fetchActivities(filters),
    enabled,
  });

export function useCreateActivity(onSuccess?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      parent,
      values,
    }: {
      parent: { deal_id?: string; lead_id?: string };
      values: ActivityFormValues;
    }) => createActivity(parent, values),
    onSuccess: () => {
      toast.success("Aktivitas dicatat");
      queryClient.invalidateQueries({ queryKey: activityQueryKeys.all });
      onSuccess?.();
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useUpdateActivity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      values,
    }: {
      id: string;
      values: Partial<{ is_done: boolean; notes: string | null; due_at: string | null }>;
    }) => updateActivity(id, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: activityQueryKeys.all });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useDeleteActivity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteActivity(id),
    onSuccess: () => {
      toast.success("Aktivitas dihapus");
      queryClient.invalidateQueries({ queryKey: activityQueryKeys.all });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export const useWaTemplates = (enabled = true) =>
  useQuery({
    queryKey: activityQueryKeys.templates,
    queryFn: fetchWaTemplates,
    staleTime: 5 * 60 * 1000,
    enabled,
  });

export function useCreateWaTemplate(onSuccess?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: { name: string; body: string }) =>
      createWaTemplate(values),
    onSuccess: () => {
      toast.success("Template dibuat");
      queryClient.invalidateQueries({ queryKey: activityQueryKeys.templates });
      onSuccess?.();
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useUpdateWaTemplate(onSuccess?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      values,
    }: {
      id: string;
      values: Partial<{ name: string; body: string }>;
    }) => updateWaTemplate(id, values),
    onSuccess: () => {
      toast.success("Template diperbarui");
      queryClient.invalidateQueries({ queryKey: activityQueryKeys.templates });
      onSuccess?.();
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useDeleteWaTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteWaTemplate(id),
    onSuccess: () => {
      toast.success("Template dinonaktifkan");
      queryClient.invalidateQueries({ queryKey: activityQueryKeys.templates });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useSendDealWa(onSuccess?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      dealId,
      payload,
    }: {
      dealId: string;
      payload: { template_id?: string; message?: string };
    }) => sendDealWa(dealId, payload),
    onSuccess: (body: { message?: string }) => {
      toast.success(body.message ?? "Pesan terkirim");
      // kirim WA mencatat aktivitas baru di timeline
      queryClient.invalidateQueries({ queryKey: activityQueryKeys.all });
      onSuccess?.();
    },
    onError: (error: Error) => toast.error(error.message),
  });
}
