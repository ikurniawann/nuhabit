import type { DashboardPeriod, DashboardRange } from "./types";

export const dashboardQueryKeys = {
  all: ["pos", "dashboard"] as const,
  summary: (period: DashboardPeriod, range?: DashboardRange | null) =>
    ["pos", "dashboard", "summary", period, range?.from ?? null, range?.to ?? null] as const,
};
