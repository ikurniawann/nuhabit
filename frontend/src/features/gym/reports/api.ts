/** Klien API Gym → Laporan Gym. Rasio dikirim 0..1. */
import { call } from "../shared";

export interface GroupStat {
  id: string;
  name: string;
  sessions: number;
  hours: number;
  checked_in: number;
  no_show: number;
  late_cancel: number;
  bookings: number;
  avg_fill: number;
  no_show_rate: number;
  late_cancel_rate: number;
}

export interface ClassReport {
  totals: {
    sessions: number;
    checked_in: number;
    no_show: number;
    late_cancel: number;
    bookings: number;
    no_show_rate: number;
    late_cancel_rate: number;
    avg_fill: number;
  };
  per_day: { day: string; checked_in: number; no_show: number; late_cancel: number }[];
  per_class_type: GroupStat[];
  per_coach: GroupStat[];
  heatmap: { weekday: number; hour: number; sessions: number; avg_fill: number }[];
}

export interface RevenueGroup {
  key: string;
  name: string;
  kind?: "credits" | "pass";
  sales: number;
  gross: number;
  share: number;
}

export interface RevenueReport {
  totals: { sales: number; gross: number; refunds: number; refund_amount: number; net: number };
  per_day: { day: string; sales: number; gross: number; refund_amount: number; net: number }[];
  per_package: RevenueGroup[];
  per_method: RevenueGroup[];
  per_branch: RevenueGroup[];
}

interface MemberRef {
  id: string;
  name: string | null;
  phone: string;
}

export interface MembersReport {
  new_members: number;
  new_per_day: { day: string; count: number }[];
  active_members: number;
  previous_active_members: number;
  churned_members: number;
  churn_rate: number;
  churned: (MemberRef & { last_visit: string })[];
  expiring_passes: (MemberRef & { package_name: string; ends_at: string })[];
  expiring_credits: (MemberRef & { credits: number; expires_at: string })[];
}

export const REPORT_KEYS = {
  classes: (query: string) => ["gym-reports", "classes", query] as const,
  revenue: (query: string) => ["gym-reports", "revenue", query] as const,
  members: (query: string) => ["gym-reports", "members", query] as const,
};

export const reportsApi = {
  classes: (query: string) => call<ClassReport>(`/api/gym/reports/classes?${query}`),
  revenue: (query: string) => call<RevenueReport>(`/api/gym/reports/revenue?${query}`),
  members: (query: string) => call<MembersReport>(`/api/gym/reports/members?${query}`),
};
