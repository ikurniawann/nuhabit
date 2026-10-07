import { apiGet, apiPut } from "@/lib/api-client";
import type { AppearanceTokens } from "@/lib/theme/appearance-tokens";
import type { AppearancePayload } from "./types";

export async function fetchCompanyAppearance(companyId?: string | null) {
  const url = companyId
    ? `/api/settings/appearance?company_id=${encodeURIComponent(companyId)}`
    : "/api/settings/appearance";
  const res = await apiGet<{ data: AppearancePayload }>(url);
  return res.data;
}

export async function saveCompanyAppearance(companyId: string, theme: AppearanceTokens) {
  const res = await apiPut<{ message: string; data: AppearancePayload }>(
    "/api/settings/appearance",
    { company_id: companyId, theme }
  );
  return res;
}
