import type { CardUnlinkReason } from "@/lib/pos/card-unlink";
import type { RefundStatus } from "@/lib/pos/member-refund";

export interface MemberCardRow {
  id: string;
  name: string | null;
  phone: string;
  membership_tier: string | null;
  member_type: string | null;
  ark_coin_balance: number | string | null;
  total_xp: number | string | null;
  nfc_uid: string;
  card_issued_at: string | null;
}
export interface UnlinkLogRow {
  id: string;
  name: string | null;
  phone: string;
  nfc_uid: string;
  reason: CardUnlinkReason;
  notes: string | null;
  balance_at_unlink: number | string | null;
  unlinked_by_name: string | null;
  created_at: string;
}
export interface RefundRequestRow {
  id: string;
  customer_id: string;
  name: string | null;
  phone: string;
  current_balance: number | string | null;
  status: RefundStatus;
  requested_amount: number | string | null;
  refunded_amount: number | string | null;
  notes: string | null;
  requested_by_name: string | null;
  requested_at: string;
  completed_by_name: string | null;
  approved_by_name: string | null;
  completed_at: string | null;
  completion_notes: string | null;
  cancelled_by_name: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
}
export interface PageData {
  members: MemberCardRow[];
  recent_unlinks: UnlinkLogRow[];
  refund_requests: RefundRequestRow[];
}

export type CardDialog =
  | { kind: "unlink"; member: MemberCardRow }
  | { kind: "refund"; member: MemberCardRow }
  | { kind: "complete"; request: RefundRequestRow }
  | { kind: "cancel"; request: RefundRequestRow }
  | null;
