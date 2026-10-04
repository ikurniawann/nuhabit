import { formatDate, formatRupiah as formatRupiahPuebi } from "@/lib/format";
import type { LeadOrgType } from "../leads/types";

export type DealEventType =
  | "gathering"
  | "field-trip"
  | "ulang-tahun"
  | "buyout-venue"
  | "lainnya";

export interface SalesStage {
  id: string;
  code: string;
  name: string;
  sort_order: number;
  is_won: boolean;
  is_lost: boolean;
  stuck_threshold_days: number;
  is_active: boolean;
  // EPIC-050 Fase 3
  pipeline_id?: string | null;
  probability?: number;
}

export interface SalesDeal {
  id: string;
  company_id: string;
  branch_id: string;
  lead_id: string;
  title: string;
  event_type: DealEventType;
  event_date: string | null;
  is_event_date_fixed: boolean;
  pax_estimate: number | null;
  stage_id: string;
  value_estimate: string | null;
  value_final: string | null;
  owner_user_id: string | null;
  lost_reason_id: string | null;
  entered_stage_at: string;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  // hasil join API
  org_name: string;
  org_type: LeadOrgType;
  pic_name: string;
  pic_phone: string;
  customer_id: string | null;
  stage_code: string;
  is_won: boolean;
  is_lost: boolean;
  stuck_threshold_days: number;
  owner_name: string | null;
  lost_reason_name: string | null;
  // EPIC-050 Fase 3
  pipeline_id?: string | null;
  forecast_category?: "pipeline" | "best_case" | "commit" | "closed_won" | "closed_lost";
  probability?: number;
  stage_name?: string;
  custom?: Record<string, unknown>;
}

export interface SalesLostReason {
  id: string;
  code: string;
  name: string;
  sort_order: number;
}

export interface DealFilters {
  q: string;
  event_type: string;
  pipeline_id?: string;
}

export interface DealFormValues {
  lead_id: string;
  pipeline_id?: string;
  custom?: Record<string, unknown>;
  title: string;
  event_type: DealEventType;
  event_date: string;
  is_event_date_fixed: boolean;
  pax_estimate: string;
  value_estimate: string;
}

export interface DealUpdatePayload {
  forecast_category?: "pipeline" | "best_case" | "commit";
  custom?: Record<string, unknown>;
  title?: string;
  event_type?: DealEventType;
  event_date?: string | null;
  is_event_date_fixed?: boolean;
  pax_estimate?: number | null;
  value_estimate?: number | null;
  value_final?: number | null;
  stage_id?: string;
  lost_reason_id?: string | null;
}

export interface StageUpdatePayload {
  probability?: number;
  name?: string;
  sort_order?: number;
  stuck_threshold_days?: number;
  is_active?: boolean;
}

export const EVENT_TYPE_LABELS: Record<DealEventType, string> = {
  gathering: "Gathering",
  "field-trip": "Field Trip",
  "ulang-tahun": "Ulang Tahun",
  "buyout-venue": "Buyout Venue",
  lainnya: "Lainnya",
};

export const EMPTY_DEAL_FORM: DealFormValues = {
  lead_id: "",
  title: "",
  event_type: "lainnya",
  event_date: "",
  is_event_date_fixed: false,
  pax_estimate: "",
  value_estimate: "",
};

/** Nilai rupiah yang boleh kosong (nilai deal, belanja member): kosong → "—". */
export function formatRupiahOrDash(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return formatRupiahPuebi(value);
}

/** Tanggal acara deal + penanda tentatif; null bila belum ada tanggal. */
export function formatEventDate(deal: Pick<SalesDeal, "event_date" | "is_event_date_fixed">): string | null {
  if (!deal.event_date) return null;
  return `${formatDate(deal.event_date)}${deal.is_event_date_fixed ? "" : " (tentatif)"}`;
}

/** Format lama untuk modul finance (di luar sales-funnel); kode sales-funnel memakai @/lib/format / formatRupiahOrDash. */
export function formatRupiah(value: string | number | null): string {
  if (value === null || value === "" || value === undefined) return "—";
  const num = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(num)) return "—";
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(num);
}

/** Umur deal di tahap sekarang (hari, dibulatkan ke bawah). */
export function daysInStage(enteredStageAt: string): number {
  const diff = Date.now() - new Date(enteredStageAt).getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

/** Deal "macet": masih berjalan & melewati ambang hari tahapnya. */
export function isDealStuck(deal: SalesDeal): boolean {
  if (deal.closed_at || deal.is_won || deal.is_lost) return false;
  if (!deal.stuck_threshold_days) return false;
  return daysInStage(deal.entered_stage_at) > deal.stuck_threshold_days;
}

// ── EPIC-050 Fase 3: pipelines & deal team ──
export interface SalesPipeline {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_default: boolean;
  sort_order: number;
  is_active: boolean;
  company_id: string | null;
  open_deals: number;
  stages: SalesStage[];
}

export interface DealMember {
  id: string;
  user_id: string;
  role: "owner" | "support" | "pre_sales" | "account_manager" | "finance";
  split_percent: string | number;
  created_at: string;
  full_name: string;
  user_role: string;
}

export const DEAL_MEMBER_ROLE_LABELS: Record<DealMember["role"], string> = {
  owner: "Owner",
  support: "Support",
  pre_sales: "Pre-sales",
  account_manager: "Account manager",
  finance: "Finance",
};

export const FORECAST_LABELS: Record<NonNullable<SalesDeal["forecast_category"]>, string> = {
  pipeline: "Pipeline",
  best_case: "Best case",
  commit: "Commit",
  closed_won: "Menang",
  closed_lost: "Kalah",
};
