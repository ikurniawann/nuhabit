/** Bentuk respons dan payload Go /api/gym/incentives. */
import type { CoachStatement, IncentiveScheme, PayoutStatus } from "@/lib/gym/incentive";

export interface SchemeRow extends IncentiveScheme {
  name: string;
  coachName: string | null;
  updatedAt: string;
}

export interface SchemeRateInput {
  class_type_id: string;
  session_fee_idr: number;
  per_attendee_idr: number;
}

export interface SchemeInput {
  id?: string;
  name: string;
  /** null = skema default organisasi. */
  coach_id: string | null;
  session_fee_idr: number;
  per_attendee_idr: number;
  full_class_bonus_idr: number;
  full_class_threshold_percent: number;
  no_show_penalty_idr: number;
  is_active: boolean;
  /** Satu tarif per jenis kelas. */
  rates: SchemeRateInput[];
}

export interface CoachStatementView extends CoachStatement {
  coachName: string;
  schemeName: string;
  /** Payout hidup (bukan void) untuk bulan ini, bila sudah dibuat. */
  payout: { id: string; status: PayoutStatus; totalIdr: number } | null;
}
