import "server-only";
/**
 * Inventori avatar collectible member (dashboard): daftar, grant admin
 * (manual/campaign/partner), dan pasang avatar aktif.
 */
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { getPool } from "@/lib/db";
import { createPgClient } from "@/lib/pg/create-client";
import type { DbClient } from "@/lib/pg/types";
import { checkAvatarEligibility } from "./collectibles-server";
import { isMissingCrmSchema, toNumber } from "./server";

export const grantAvatarSchema = z.object({
  action: z.literal("grant"),
  member_id: z.string().uuid(),
  avatar_id: z.string().uuid(),
  acquisition_source: z.enum(["manual", "campaign", "partner"]).default("manual"),
  equip: z.boolean().default(false),
  note: z.string().trim().max(240).optional(),
});

export const equipAvatarSchema = z.object({
  member_id: z.string().uuid(),
  inventory_id: z.string().uuid().optional(),
  avatar_id: z.string().uuid().optional(),
}).refine((value) => value.inventory_id || value.avatar_id, {
  message: "inventory_id atau avatar_id wajib diisi",
  path: ["inventory_id"],
});

type TierRow = {
  id: string;
  code: string;
  name: string;
  rank: number | string | null;
};

type MemberRow = {
  id: string;
  customer_id: string | null;
  lifetime_xp: number | string | null;
  active_avatar_id: string | null;
  tier?: TierRow | TierRow[] | null;
};

type AvatarRow = {
  id: string;
  code: string;
  name: string;
  rarity: string;
  image_url: string;
  thumbnail_url: string | null;
  required_tier_id: string | null;
  xp_cost: number | string | null;
  stock_total: number | string | null;
  stock_redeemed: number | string | null;
  is_active: boolean;
  required_tier?: TierRow | TierRow[] | null;
};

function normalizeTier(tier: TierRow | TierRow[] | null | undefined) {
  return Array.isArray(tier) ? tier[0] ?? null : tier ?? null;
}

async function loadMember(
  db: DbClient,
  input: { memberId?: string; customerId?: string }
) {
  let query = db
    .from("crm_member_profiles")
    .select("id, customer_id, lifetime_xp, active_avatar_id, tier:crm_membership_tiers(id, code, name, rank)")
    .eq("status", "active");

  query = input.memberId ? query.eq("id", input.memberId) : query.eq("customer_id", input.customerId);

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const member = data as unknown as MemberRow;
  return {
    ...member,
    tier: normalizeTier(member.tier),
  };
}

/** Inventori satu member (by member_id atau customer_id); null bila skema CRM belum siap. */
export async function listAvatarInventory(input: { memberId: string | null; customerId: string | null }) {
  const db = createPgClient();
  let query = db
    .from("crm_member_avatar_inventory")
    .select("*, avatar:crm_collectible_avatars(*, required_tier:crm_membership_tiers(code, name, rank))")
    .order("acquired_at", { ascending: false });

  if (input.memberId) {
    query = query.eq("member_id", input.memberId);
  } else if (input.customerId) {
    const member = await loadMember(db, { customerId: input.customerId });
    if (!member) return [];
    query = query.eq("member_id", member.id);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingCrmSchema(error)) return null;
    throw error;
  }
  return data ?? [];
}

/**
 * Grant avatar oleh admin. EPIC-014 Task 2: required_tier_id + min_lifetime_xp
 * DITEGAKKAN di jalur ini juga — satu aturan dari modul bersama. Avatar
 * langsung dipasang bila diminta atau member belum punya avatar aktif.
 */
export async function grantAvatar(payload: z.infer<typeof grantAvatarSchema>) {
  const db = createPgClient();
  const member = await loadMember(db, { memberId: payload.member_id });
  if (!member) throw ApiError.conflict("Member CRM belum aktif. Aktifkan member terlebih dahulu.");

  const existing = await db
    .from("crm_member_avatar_inventory")
    .select("id")
    .eq("member_id", member.id)
    .eq("avatar_id", payload.avatar_id)
    .maybeSingle();

  if (existing.error && !isMissingCrmSchema(existing.error)) throw existing.error;
  if (existing.data) throw ApiError.conflict("Member sudah memiliki avatar ini");

  const { data: avatarData, error: avatarError } = await db
    .from("crm_collectible_avatars")
    .select("*, required_tier:crm_membership_tiers(id, code, name, rank)")
    .eq("id", payload.avatar_id)
    .maybeSingle();

  if (avatarError) throw avatarError;
  if (!avatarData) throw ApiError.notFound("Avatar tidak ditemukan");

  const avatar = avatarData as unknown as AvatarRow;
  const stockTotal = avatar.stock_total == null ? null : toNumber(avatar.stock_total);
  const stockRedeemed = toNumber(avatar.stock_redeemed);

  if (!avatar.is_active) throw ApiError.badRequest("Avatar sedang tidak aktif");
  if (stockTotal !== null && stockRedeemed >= stockTotal) throw ApiError.badRequest("Stok avatar sudah habis");

  if (member.customer_id) {
    const eligibility = await checkAvatarEligibility(getPool(), avatar.id, member.customer_id);
    if (!eligibility.allowed) throw ApiError.forbidden(`Member belum memenuhi syarat: ${eligibility.reason}`);
  }

  const shouldEquip = payload.equip || !member.active_avatar_id;
  if (shouldEquip) {
    const { error: unequipError } = await db
      .from("crm_member_avatar_inventory")
      .update({ is_equipped: false })
      .eq("member_id", member.id);
    if (unequipError) throw unequipError;
  }

  const { data: inventory, error: inventoryError } = await db
    .from("crm_member_avatar_inventory")
    .insert({
      member_id: member.id,
      avatar_id: avatar.id,
      redemption_id: null,
      acquisition_source: payload.acquisition_source,
      is_equipped: shouldEquip,
      metadata: {
        granted_by: "crm_admin",
        note: payload.note ?? null,
      },
    })
    .select("*, avatar:crm_collectible_avatars(*)")
    .single();
  if (inventoryError) throw inventoryError;

  const { error: memberUpdateError } = await db
    .from("crm_member_profiles")
    .update({
      active_avatar_id: shouldEquip ? avatar.id : member.active_avatar_id,
      last_activity_at: new Date().toISOString(),
    })
    .eq("id", member.id);
  if (memberUpdateError) throw memberUpdateError;

  if (stockTotal !== null) {
    const { error: avatarStockError } = await db
      .from("crm_collectible_avatars")
      .update({ stock_redeemed: stockRedeemed + 1 })
      .eq("id", avatar.id);
    if (avatarStockError) throw avatarStockError;
  }

  return inventory;
}

/** Pasang avatar yang sudah dimiliki member sebagai avatar aktif. */
export async function equipAvatar(payload: z.infer<typeof equipAvatarSchema>) {
  const db = createPgClient();
  let inventoryQuery = db
    .from("crm_member_avatar_inventory")
    .select("id, member_id, avatar_id")
    .eq("member_id", payload.member_id);
  inventoryQuery = payload.inventory_id
    ? inventoryQuery.eq("id", payload.inventory_id)
    : inventoryQuery.eq("avatar_id", payload.avatar_id);

  const { data: inventory, error: inventoryError } = await inventoryQuery.maybeSingle();
  if (inventoryError) throw inventoryError;
  if (!inventory) throw ApiError.notFound("Avatar belum dimiliki member");

  const owned = inventory as { id: string; member_id: string; avatar_id: string };
  const { error: unequipError } = await db
    .from("crm_member_avatar_inventory")
    .update({ is_equipped: false })
    .eq("member_id", payload.member_id);
  if (unequipError) throw unequipError;

  const { error: equipError } = await db
    .from("crm_member_avatar_inventory")
    .update({ is_equipped: true })
    .eq("id", owned.id);
  if (equipError) throw equipError;

  const { error: memberUpdateError } = await db
    .from("crm_member_profiles")
    .update({
      active_avatar_id: owned.avatar_id,
      last_activity_at: new Date().toISOString(),
    })
    .eq("id", payload.member_id);
  if (memberUpdateError) throw memberUpdateError;

  return owned;
}
