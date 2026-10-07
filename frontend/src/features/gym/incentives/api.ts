/** Klien API Gym → Insentif Coach. */

import type { CoachStatement, PayoutAction, PayoutStatus } from "@/lib/gym/incentive";
import type { CoachStatementView, SchemeInput, SchemeRow } from "@/lib/gym/incentive-server";
import { call, remove, send } from "../shared";

export type { SchemeInput };

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
  saveScheme: (input: SchemeInput) => send<{ id: string }>("/api/gym/incentives/schemes", input),
  deleteScheme: (id: string) => remove<{ id: string }>(`/api/gym/incentives/schemes?id=${id}`),

  statements: (month: string) => call<CoachStatementView[]>(`/api/gym/incentives/statements?month=${month}`),

  payouts: (month: string) => call<PayoutRow[]>(`/api/gym/incentives/payouts?month=${month}`),
  payout: (id: string) => call<PayoutDetail>(`/api/gym/incentives/payouts/${id}`),
  createPayout: (coachId: string, month: string) =>
    send<{ id: string }>("/api/gym/incentives/payouts", { coach_id: coachId, month }),
  actOnPayout: (id: string, action: PayoutAction, extra: { payment_reference?: string; note?: string } = {}) =>
    send<{ id: string }>(`/api/gym/incentives/payouts/${id}`, { action, ...extra }),
};

/** `YYYY-MM` bulan berjalan (zona browser). */
export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
