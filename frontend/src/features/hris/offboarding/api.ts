import { apiGet, apiPost, apiPut } from "@/lib/api-client";
import type {
  OffboardingEmployee,
  OffboardingRecord,
  InitiateOffboardingPayload,
  UpdateOffboardingPayload,
} from "./types";

export async function fetchOffboardingEmployee(
  employeeId: string
): Promise<OffboardingEmployee | null> {
  const res = await apiGet<{ data: OffboardingEmployee | null }>(
    `/api/hris/employees/${employeeId}`
  ).catch(() => ({ data: null }));
  return res.data ?? null;
}

export async function fetchOffboardingRecord(
  employeeId: string
): Promise<OffboardingRecord | null> {
  const res = await apiGet<{ data: OffboardingRecord[] }>(
    `/api/hris/offboarding/${employeeId}`
  ).catch(() => ({ data: [] as OffboardingRecord[] }));
  return res.data?.[0] ?? null;
}

export const initiateOffboarding = (
  employeeId: string,
  body: InitiateOffboardingPayload
) => apiPost<{ data: OffboardingRecord }>(`/api/hris/offboarding/${employeeId}`, body);

export const updateOffboarding = (
  employeeId: string,
  body: UpdateOffboardingPayload
) => apiPut<{ data: OffboardingRecord }>(`/api/hris/offboarding/${employeeId}`, body);
