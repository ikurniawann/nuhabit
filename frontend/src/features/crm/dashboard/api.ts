import type { CrmDashboardResult } from "./types";
import { parseCrmResponse } from "../http";

export type * from "./types";

export async function getCrmDashboard(): Promise<CrmDashboardResult> {
  const response = await fetch("/api/crm/dashboard", { cache: "no-store" });
  const json = await parseCrmResponse<{ data: CrmDashboardResult["data"]; meta?: { schemaReady?: boolean } }>(
    response,
    "Gagal memuat dashboard CRM"
  );
  return {
    data: json.data,
    schemaReady: Boolean(json.meta?.schemaReady),
  };
}
