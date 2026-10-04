import type {
  CrmMember,
  MemberDetailBundle,
  MemberListParams,
  MemberListResult,
  UpdateMemberPayload,
} from "./types";
import { parseCrmResponse } from "../http";

export type * from "./types";

export async function listMembers(params: MemberListParams = {}): Promise<MemberListResult> {
  const sp = new URLSearchParams({ limit: String(params.limit ?? 100) });
  if (params.search) sp.set("search", params.search);
  if (params.tier && params.tier !== "all") sp.set("tier", params.tier);

  const response = await fetch(`/api/crm/members?${sp.toString()}`, { cache: "no-store" });
  const json = await parseCrmResponse<{ data: CrmMember[]; meta?: { schemaReady?: boolean } }>(
    response,
    "Gagal memuat member CRM"
  );
  return {
    members: json.data ?? [],
    schemaReady: Boolean(json.meta?.schemaReady),
  };
}

export async function getMemberDetailBundle(memberId: string): Promise<MemberDetailBundle> {
  const [response, rewardsResponse, tiersResponse, avatarsResponse] = await Promise.all([
    fetch(`/api/crm/members/${memberId}`, { cache: "no-store" }),
    fetch("/api/crm/rewards", { cache: "no-store" }),
    fetch("/api/crm/tiers", { cache: "no-store" }),
    fetch("/api/crm/avatars", { cache: "no-store" }),
  ]);

  const json = await parseCrmResponse<{
    data: { member: CrmMember; xpLedger: MemberDetailBundle["xpLedger"]; recentOrders: MemberDetailBundle["recentOrders"] };
  }>(response, "Gagal memuat detail member");

  const [rewardsJson, tiersJson, avatarsJson] = await Promise.all([
    parseCrmResponse<{ data: MemberDetailBundle["rewards"] }>(rewardsResponse, "Gagal memuat reward"),
    parseCrmResponse<{ data: MemberDetailBundle["tiers"] }>(tiersResponse, "Gagal memuat tier"),
    parseCrmResponse<{ data: MemberDetailBundle["avatars"] }>(avatarsResponse, "Gagal memuat avatar"),
  ]);

  const loadedMember = json.data.member;
  const isCrmProfile = !loadedMember.id.startsWith("pos-");
  let redemptions: MemberDetailBundle["redemptions"] = [];
  let avatarInventory: MemberDetailBundle["avatarInventory"] = [];

  // Redemption dikunci ke customer_id (Fase F): member_id boleh NULL untuk
  // member tanpa profil CRM, jadi filter member_id akan menyembunyikan baris.
  if (loadedMember.customer_id) {
    const redemptionsResponse = await fetch(
      `/api/crm/redemptions?customer_id=${loadedMember.customer_id}`,
      { cache: "no-store" }
    );
    const redemptionsJson = await parseCrmResponse<{ data: MemberDetailBundle["redemptions"] }>(
      redemptionsResponse,
      "Gagal memuat redemption"
    );
    redemptions = redemptionsJson.data ?? [];
  }

  // Inventory avatar tetap berbasis profil CRM (tabel terpisah).
  if (isCrmProfile) {
    const inventoryResponse = await fetch(
      `/api/crm/avatar-inventory?member_id=${loadedMember.id}`,
      { cache: "no-store" }
    );
    const inventoryJson = await parseCrmResponse<{ data: MemberDetailBundle["avatarInventory"] }>(
      inventoryResponse,
      "Gagal memuat avatar inventory"
    );
    avatarInventory = inventoryJson.data ?? [];
  }

  return {
    member: loadedMember,
    xpLedger: json.data.xpLedger ?? [],
    recentOrders: json.data.recentOrders ?? [],
    rewards: rewardsJson.data ?? [],
    tiers: tiersJson.data ?? [],
    avatars: avatarsJson.data ?? [],
    redemptions,
    avatarInventory,
  };
}

export async function enrollMember(
  customerId: string,
  metadata?: Record<string, unknown>
): Promise<CrmMember> {
  const response = await fetch("/api/crm/members", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customer_id: customerId, metadata }),
  });
  const json = await parseCrmResponse<{ data: CrmMember }>(response, "Gagal aktivasi member CRM");
  return json.data;
}

export async function updateMember(
  id: string,
  payload: UpdateMemberPayload
): Promise<void> {
  const response = await fetch(`/api/crm/members/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await parseCrmResponse(response, "Gagal menyimpan member");
}

// createRedemption & redeemAvatar dihapus (EPIC-011): endpoint redeem XP
// sudah pensiun (410) — XP lifetime tidak pernah berkurang.

export async function equipAvatar(memberId: string, inventoryId: string): Promise<void> {
  const response = await fetch("/api/crm/avatar-inventory", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ member_id: memberId, inventory_id: inventoryId }),
  });
  await parseCrmResponse(response, "Gagal memakai avatar");
}

export async function grantAvatar(payload: {
  member_id: string;
  avatar_id: string;
  acquisition_source: "manual" | "campaign" | "partner";
  equip: boolean;
}): Promise<void> {
  const response = await fetch("/api/crm/avatar-inventory", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "grant", ...payload }),
  });
  await parseCrmResponse(response, "Gagal grant avatar");
}
