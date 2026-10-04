import type { AttentionRow } from "./recruitment-report";

export interface DashboardSummary {
  thisMonth: number;
  activePipeline: number;
  talentPool: number;
  openPositions: number;
}

export interface WeeklyPoint {
  week: string;
  candidates: number;
}

export interface SourceDatum {
  name: string;
  value: number;
}

export interface FunnelDatum {
  name: string;
  value: number;
}

export type AttentionItem = AttentionRow & { id: string };

export interface DashboardData {
  summary: DashboardSummary;
  weeklyApps: WeeklyPoint[];
  sourceDist: SourceDatum[];
  pipelineFunnel: FunnelDatum[];
  needsAttention: AttentionItem[];
}
