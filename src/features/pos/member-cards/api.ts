import { apiGet, apiPost } from "@/lib/api-client";
import type { MemberCardRow, PageData } from "./types";

export const memberCardsQueryKey = (search: string) => ["pos", "member-cards", search] as const;

export async function fetchMemberCards(search: string): Promise<PageData> {
  const res = await apiGet<{ data: PageData }>(`/api/pos/member-cards?search=${encodeURIComponent(search)}`);
  return res.data;
}

/** Member pemilik kartu yang di-tap; null bila kartu tidak terdaftar / sudah dilepas. */
export async function fetchMemberByCard(uid: string): Promise<MemberCardRow | null> {
  const res = await apiGet<{ data: PageData }>(`/api/pos/member-cards?nfc_uid=${encodeURIComponent(uid)}`);
  return res.data.members[0] ?? null;
}

export type MemberCardAction =
  | { kind: "unlink"; memberId: string; body: { reason: string; notes: string } }
  | { kind: "refund"; memberId: string; body: { notes: string } }
  | { kind: "complete"; requestId: string; body: { supervisor_pin: string; notes: string } }
  | { kind: "cancel"; requestId: string; body: { reason: string } };

const ACTION_URL: Record<MemberCardAction["kind"], (id: string) => string> = {
  unlink: (id) => `/api/pos/member-cards/${id}/unlink`,
  refund: (id) => `/api/pos/member-cards/${id}/refund`,
  complete: (id) => `/api/pos/member-refunds/${id}/complete`,
  cancel: (id) => `/api/pos/member-refunds/${id}/cancel`,
};

/** Kirim aksi kartu/refund; mengembalikan pesan sukses dari server. */
export async function submitMemberCardAction(action: MemberCardAction): Promise<string> {
  const id = "memberId" in action ? action.memberId : action.requestId;
  const res = await apiPost<{ message?: string }>(ACTION_URL[action.kind](id), action.body);
  return res.message ?? "Berhasil";
}
