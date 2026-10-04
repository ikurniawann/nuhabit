"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { kpiQueryKeys } from "./query-keys";
import {
  fetchDeptTasks,
  fetchKpiConfig,
  fetchPerfCycles,
  fetchPerfRealtime,
  fetchPerfReview,
  fetchPerfReviews,
  fetchKpiHistory,
  fetchKpiScorecards,
  fetchKpiTargets,
  fetchKpiTeam,
} from "./api";

export const useKpiScorecards = (params: {
  period_year: number;
  period_month: number;
  employee_id?: string;
}) =>
  useQuery({
    queryKey: kpiQueryKeys.scorecards(params),
    queryFn: () => fetchKpiScorecards(params),
  });

export const useKpiHistory = (employeeId: string, n = 12) =>
  useQuery({
    queryKey: kpiQueryKeys.history(employeeId, n),
    queryFn: () => fetchKpiHistory({ employee_id: employeeId, history: n }),
  });

export const useKpiTeam = (params: {
  period_year: number;
  period_month: number;
}) =>
  useQuery({
    queryKey: kpiQueryKeys.team(params),
    queryFn: () => fetchKpiTeam(params),
  });

export const useKpiTargets = (enabled = true) =>
  useQuery({
    queryKey: kpiQueryKeys.targets(),
    queryFn: fetchKpiTargets,
    enabled,
  });

export const useDeptTasks = (month: string, departmentId: string) =>
  useQuery({
    queryKey: kpiQueryKeys.deptTasks(month, departmentId),
    queryFn: () => fetchDeptTasks(month, departmentId || undefined),
    // Pertahankan data lama saat ganti bulan/departemen (filter tidak hilang).
    placeholderData: keepPreviousData,
  });

export const usePerfRealtime = (year?: number, quarter?: number) =>
  useQuery({
    queryKey: kpiQueryKeys.perfRealtime(year, quarter),
    queryFn: () => fetchPerfRealtime(year, quarter),
  });

export const usePerfCycles = () =>
  useQuery({ queryKey: kpiQueryKeys.perfCycles(), queryFn: fetchPerfCycles });

export const usePerfReviews = (cycleId: string) =>
  useQuery({
    queryKey: kpiQueryKeys.perfReviews(cycleId),
    queryFn: () => fetchPerfReviews(cycleId),
    enabled: !!cycleId,
  });

export const usePerfReview = (id: string | null) =>
  useQuery({
    queryKey: kpiQueryKeys.perfReview(id ?? ""),
    queryFn: () => fetchPerfReview(id ?? ""),
    enabled: !!id,
  });

export const useKpiConfig = () =>
  useQuery({ queryKey: kpiQueryKeys.config(), queryFn: fetchKpiConfig });
