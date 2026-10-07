import { getDashboardStats } from "@/lib/pos-api";
import type { DashboardBundle, DashboardPeriod, DashboardRange } from "./types";

export type * from "./types";

export async function getPosDashboard(
  period: DashboardPeriod = "today",
  range?: DashboardRange | null
): Promise<DashboardBundle> {
  const res = await getDashboardStats(period, range ?? undefined);
  if (!res.success || !res.data) {
    throw new Error((res as { error?: string }).error || "Failed to load dashboard data");
  }

  const data = res.data as DashboardBundle;
  return {
    stats: data.stats ?? null,
    topProducts: data.topProducts ?? [],
    recentOrders: data.recentOrders ?? [],
    arkXp: data.arkXp ?? null,
    trend: data.trend ?? [],
    topLoyalMembers: data.topLoyalMembers ?? [],
  };
}
