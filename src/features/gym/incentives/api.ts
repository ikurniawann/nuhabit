/** Klien API Gym → Insentif Coach. */

import type { CoachStatement, PayoutAction, PayoutStatus } from "@/lib/gym/incentive";
import type { CoachStatementView, SchemeRow } from "@/lib/gym/incentive-server";
import { call, post, remove } from "../training/api";

export interface SchemeInput {
  id?: string;
  name: string;
  coach_id: string | null;
  session_fee_idr: number;
  per_attendee_idr: number;
  full_class_bonus_idr: number;
  full_class_threshold_percent: number;
  no_show_penalty_idr: number;
  is_active: boolean;
  rates: { class_type_id: string; session_fee_idr: number; per_attendee_idr: number }[];
}

export interface NamedOption {
  id: string;
  name: string;
  status: string;
}

export interface PayoutRow {
  id: string;
  coach_id: string;
  coach_name: string;
  month: string;
  total_idr: number;
  status: PayoutStatus;
  payment_reference: string | null;
  note: string | null;
  sessions: number;
  created_at: string;
  approved_at: string | null;
  paid_at: string | null;
  voided_at: string | null;
}

export interface PayoutDetail extends Omit<PayoutRow, "sessions"> {
  statement: CoachStatement;
}

export const incentivesApi = {
  schemes: () => call<{ schemes: SchemeRow[]; coaches: NamedOption[]; class_types: NamedOption[] }>("/api/gym/incentives/schemes"),
  saveScheme: (input: SchemeInput) => post<{ id: string }>("/api/gym/incentives/schemes", input),
  deleteScheme: (id: string) => remove<{ id: string }>(`/api/gym/incentives/schemes?id=${id}`),

  statements: (month: string) => call<CoachStatementView[]>(`/api/gym/incentives/statements?month=${month}`),

  payouts: (month: string) => call<PayoutRow[]>(`/api/gym/incentives/payouts?month=${month}`),
  payout: (id: string) => call<PayoutDetail>(`/api/gym/incentives/payouts/${id}`),
  createPayout: (coachId: string, month: string) =>
    post<{ id: string }>("/api/gym/incentives/payouts", { coach_id: coachId, month }),
  actOnPayout: (id: string, action: PayoutAction, extra: { payment_reference?: string; note?: string } = {}) =>
    post<{ id: string }>(`/api/gym/incentives/payouts/${id}`, { action, ...extra }),
};

/** `YYYY-MM` bulan berjalan (zona browser). */
export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
