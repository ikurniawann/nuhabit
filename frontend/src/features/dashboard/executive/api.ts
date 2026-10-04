import { apiGet, apiPut } from "@/lib/api-client";
import type { ExecutiveDashboard } from "@/lib/dashboard/executive";
import type { SalesTargetConfig } from "@/lib/dashboard/sales-target";

export const fetchExecutiveDashboard = () =>
  apiGet<{
    data: ExecutiveDashboard;
    target?: SalesTargetConfig;
    cached?: boolean;
  }>("/api/dashboard/executive");

export const saveSalesTarget = (body: {
  harianRp: string | number;
  bulananRp: string | number;
}) =>
  apiPut<{ data: { config: SalesTargetConfig } }>(
    "/api/settings/sales-target",
    body,
  ).then((r) => r.data.config);
