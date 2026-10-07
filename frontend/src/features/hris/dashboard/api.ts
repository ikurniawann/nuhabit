import { apiGet, buildListUrl } from "@/lib/api-client";
import type { DashboardData } from "./types";

interface WeeklyRow {
  label?: string;
  week?: string;
  count: number;
}

interface FunnelRow {
  stage: string;
  count: number;
}

/** Endpoint dashboard lama tidak seragam; galat satu kartu tidak menggagalkan halaman. */
const getOr = <T,>(url: string, fallback: T) => apiGet<T>(url).catch(() => fallback);

export async function fetchDashboardData(brandFilter: string, period: string): Promise<DashboardData> {
  const brand_id = brandFilter !== "all" ? brandFilter : undefined;
  const url = (path: string, extra?: Record<string, string>) =>
    buildListUrl(`/api/dashboard/${path}`, { ...extra, brand_id });

  const [stats, weekly, sources, funnel, attention] = await Promise.all([
    getOr<Partial<Record<"candidates_this_month" | "active_pipeline" | "talent_pool" | "open_positions", number>>>(
      url("stats"),
      {}
    ),
    getOr<WeeklyRow[]>(url("weekly", { period }), []),
    getOr<DashboardData["sourceDist"]>(url("sources"), []),
    getOr<FunnelRow[]>(url("funnel"), []),
    getOr<{ data?: DashboardData["needsAttention"] }>(url("attention"), {}),
  ]);

  return {
    summary: {
      thisMonth: stats.candidates_this_month || 0,
      activePipeline: stats.active_pipeline || 0,
      talentPool: stats.talent_pool || 0,
      openPositions: stats.open_positions || 0,
    },
    weeklyApps: (Array.isArray(weekly) ? weekly : []).map((w) => ({
      week: w.label || w.week || "",
      candidates: w.count,
    })),
    sourceDist: Array.isArray(sources) ? sources : [],
    pipelineFunnel: (Array.isArray(funnel) ? funnel : []).map((f) => ({ name: f.stage, value: f.count })),
    needsAttention: attention.data || [],
  };
}
