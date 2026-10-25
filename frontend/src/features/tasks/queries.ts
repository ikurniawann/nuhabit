"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchContributions, fetchKpiTasks, fetchMonitor, fetchOccurrence, fetchTaskItems, fetchTaskMeta } from "./api";
import { taskKeys } from "./query-keys";
import type { TaskListFilter } from "./types";

export const useTaskMeta = () => useQuery({ queryKey: taskKeys.meta(), queryFn: fetchTaskMeta, staleTime: 60_000 });

export const useTaskItems = (filter: TaskListFilter, enabled = true) =>
  useQuery({
    queryKey: taskKeys.list(filter),
    queryFn: () => fetchTaskItems(filter),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useOccurrence = (id: string | null) =>
  useQuery({
    queryKey: taskKeys.detail(id ?? ""),
    queryFn: () => fetchOccurrence(id as string),
    enabled: !!id,
  });

export const useKpiTasks = (params: { department_id?: string; month?: string }, enabled = true) =>
  useQuery({
    queryKey: taskKeys.kpi(params),
    queryFn: () => fetchKpiTasks(params),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useTaskContributions = (params: { employee_id: string; month: string }, enabled = true) =>
  useQuery({
    queryKey: taskKeys.contributions(params),
    queryFn: () => fetchContributions(params),
    enabled: enabled && !!params.employee_id,
  });

export const useTaskMonitor = (params: { department_id?: string; month: string }, enabled = true) =>
  useQuery({
    queryKey: taskKeys.monitor(params),
    queryFn: () => fetchMonitor(params),
    placeholderData: keepPreviousData,
    enabled,
  });
