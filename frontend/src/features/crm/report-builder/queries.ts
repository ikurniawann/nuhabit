"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ReportDefinition } from "@/lib/crm/report-builder";
import * as api from "./api";
import type { ScheduleInput, WidgetInput } from "./types";

export const K = {
  registry: ["crm", "report-builder", "registry"] as const,
  reports: ["crm", "report-builder", "reports"] as const,
  report: (id: string) => ["crm", "report-builder", "report", id] as const,
  dashboards: ["crm", "report-builder", "dashboards"] as const,
  dashboard: (id: string) => ["crm", "report-builder", "dashboard", id] as const,
  schedules: ["crm", "report-builder", "schedules"] as const,
};

function mutation<TArgs>(fn: (args: TArgs) => Promise<unknown>, keys: readonly (readonly string[])[], okMessage: string) {
  return function useIt() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: fn,
      onSuccess: (body) => {
        const msg = (body as { message?: string } | undefined)?.message;
        toast.success(msg ?? okMessage);
        for (const k of keys) qc.invalidateQueries({ queryKey: k });
      },
      onError: (e: Error) => toast.error(e.message),
    });
  };
}

export const useReportRegistry = () => useQuery({ queryKey: K.registry, queryFn: api.fetchRegistry, staleTime: 30 * 60_000 });
export const useSavedReports = () => useQuery({ queryKey: K.reports, queryFn: api.fetchReports });
export const useSavedReport = (id: string | null) =>
  useQuery({ queryKey: K.report(id ?? ""), queryFn: () => api.runSavedReport(id as string), enabled: Boolean(id) });

/** Pratinjau builder: dijalankan manual lewat mutate(), bukan otomatis tiap ketikan. */
export function useRunDefinition() {
  return useMutation({
    mutationFn: (definition: ReportDefinition) => api.runDefinition(definition),
    onError: (e: Error) => toast.error(e.message),
  });
}

export const useCreateReport = mutation(
  (v: { name: string; description?: string | null; definition: ReportDefinition; is_shared: boolean }) => api.createReport(v),
  [K.reports], "Report disimpan"
);
export const useUpdateReport = mutation(
  ({ id, values }: { id: string; values: Partial<{ name: string; description: string | null; definition: ReportDefinition; is_shared: boolean }> }) =>
    api.updateReport(id, values),
  [K.reports], "Report diperbarui"
);
export const useDeleteReport = mutation((id: string) => api.deleteReport(id), [K.reports], "Report dihapus");

export const useDashboards = () => useQuery({ queryKey: K.dashboards, queryFn: api.fetchDashboards });
export const useDashboard = (id: string | null) =>
  useQuery({ queryKey: K.dashboard(id ?? ""), queryFn: () => api.fetchDashboard(id as string), enabled: Boolean(id) });
export const useCreateDashboard = mutation(
  (v: { name: string; description?: string | null; is_default: boolean }) => api.createDashboard(v),
  [K.dashboards], "Dashboard dibuat"
);
export const useUpdateDashboard = mutation(
  ({ id, values }: { id: string; values: Partial<{ name: string; description: string | null; is_default: boolean; widgets: WidgetInput[] }> }) =>
    api.updateDashboard(id, values),
  [K.dashboards, ["crm", "report-builder", "dashboard"]], "Dashboard diperbarui"
);
export const useDeleteDashboard = mutation((id: string) => api.deleteDashboard(id), [K.dashboards], "Dashboard dihapus");

export const useSchedules = () => useQuery({ queryKey: K.schedules, queryFn: api.fetchSchedules });
export const useCreateSchedule = mutation((v: ScheduleInput) => api.createSchedule(v), [K.schedules, K.reports], "Jadwal dibuat");
export const useUpdateSchedule = mutation(
  ({ id, values }: { id: string; values: Partial<ScheduleInput> }) => api.updateSchedule(id, values),
  [K.schedules], "Jadwal diperbarui"
);
export const useDeleteSchedule = mutation((id: string) => api.deleteSchedule(id), [K.schedules, K.reports], "Jadwal dihapus");
export const useRunScheduleNow = mutation((id: string) => api.runScheduleNow(id), [K.schedules], "Laporan dikirim");
