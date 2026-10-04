import { apiGet, apiPost, buildListUrl } from "@/lib/api-client";
import { overtimeListParams, type OvertimeAssignForm } from "@/lib/hris/overtime-view";
import type { OvertimeDecision, OvertimeFilters, OvertimeRow } from "./types";

export const fetchOvertime = ({ status, month }: OvertimeFilters) =>
  apiGet<{ data: OvertimeRow[] }>(
    buildListUrl("/api/hris/overtime", overtimeListParams(status, month))
  ).then((res) => res.data ?? []);

export const assignOvertime = (form: OvertimeAssignForm) =>
  apiPost<{ message?: string }>("/api/hris/overtime", form);

export const decideOvertime = (decision: OvertimeDecision) =>
  apiPost<{ message?: string }>("/api/hris/overtime/decide", decision);
