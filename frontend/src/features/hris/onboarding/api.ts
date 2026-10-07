import { apiGet } from "@/lib/api-client";
import type { OnboardingEmployee } from "./types";

export async function fetchOnboardingEmployee(
  employeeId: string
): Promise<OnboardingEmployee | null> {
  const detail = await apiGet<{ data: OnboardingEmployee | null }>(
    `/api/hris/employees/${employeeId}`
  ).catch(() => ({ data: null }));

  if (detail.data) return detail.data;

  const list = await apiGet<{ data: OnboardingEmployee[] }>(
    `/api/hris/employees?search=${employeeId}`
  ).catch(() => ({ data: [] as OnboardingEmployee[] }));

  return list.data?.[0] ?? null;
}
