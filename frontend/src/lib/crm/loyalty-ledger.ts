// Penulis ledger XP: enrol profil member, posting baris earn idempoten.
import type { DbClient } from "@/lib/pg/types";
import { isMissingCrmSchema, toNumber } from "@/lib/crm/server";
import type {
  CrmMemberProfile,
  CrmTier,
  CrmXpAwardResult,
  PosCustomerLoyaltyRow,
} from "./loyalty-rules";
import { syncAfterEarn } from "./loyalty-tier-sync";

type PostXpEventInput = {
  customerId: string;
  sourceType: string;
  sourceId?: string | null;
  outletId?: string | null;
  companyId?: string | null;
  branchId?: string | null;
  xpAmount: number;
  ruleId?: string | null;
  referenceTable: string;
  referenceId: string;
  idempotencyKey: string;
  description: string;
  metadata?: Record<string, unknown>;
  /** false = XP nominal apa adanya (mis. Free XP profil) — tanpa multiplier tier */
  applyTierMultiplier?: boolean;
  /** Kanal ledger; default "pos". Partner eksternal memakai kanalnya sendiri. */
  sourceChannel?: string;
};

const PROFILE_WITH_TIER = "*, tier:crm_membership_tiers(id, code, name, rank, xp_multiplier)";

export async function postXpEvent(db: DbClient, input: PostXpEventInput): Promise<CrmXpAwardResult> {
  if (input.xpAmount <= 0) {
    return { status: "skipped", xpAwarded: 0, reason: "zero_xp" };
  }

  const existing = await db
    .from("crm_xp_ledger")
    .select("id, xp_delta")
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();

  if (existing.error && !isMissingCrmSchema(existing.error)) throw existing.error;
  if (existing.data) {
    return { status: "duplicate", xpAwarded: 0, ledgerIds: [existing.data.id] };
  }

  const member = await ensureMemberProfile(db, input.customerId);
  if (!member) return { status: "skipped", xpAwarded: 0, reason: "member_profile_unavailable" };

  const tierMultiplier =
    input.applyTierMultiplier === false
      ? 1
      : input.ruleId ? await getTierMultiplierForRule(db, input.ruleId, member) : toNumber(member.tier?.xp_multiplier) || 1;
  const xpDelta = Math.max(0, Math.floor(input.xpAmount * tierMultiplier));
  if (xpDelta <= 0) return { status: "skipped", xpAwarded: 0, reason: "zero_xp" };

  // XP lifetime append-only (EPIC-011): tidak ada lagi saldo XP terpisah —
  // balance_* di ledger diisi nilai lifetime agar kolom NOT NULL tetap valid.
  const lifetimeBefore = toNumber(member.lifetime_xp);
  const lifetimeAfter = lifetimeBefore + xpDelta;

  const { data: ledger, error: ledgerError } = await db
    .from("crm_xp_ledger")
    .insert({
      member_id: member.id,
      customer_id: input.customerId,
      direction: "earn",
      source_channel: input.sourceChannel ?? "pos",
      source_type: input.sourceType,
      source_id: input.sourceId ?? null,
      outlet_id: input.outletId ?? null,
      company_id: input.companyId ?? null,
      branch_id: input.branchId ?? null,
      xp_delta: xpDelta,
      balance_before: lifetimeBefore,
      balance_after: lifetimeAfter,
      lifetime_before: lifetimeBefore,
      lifetime_after: lifetimeAfter,
      rule_id: input.ruleId ?? null,
      reference_table: input.referenceTable,
      reference_id: input.referenceId,
      idempotency_key: input.idempotencyKey,
      description: input.description,
      metadata: input.metadata ?? {},
    })
    .select("id")
    .single();

  if (ledgerError) {
    if (ledgerError.code === "23505") return { status: "duplicate", xpAwarded: 0 };
    throw ledgerError;
  }

  const { error: profileError } = await db
    .from("crm_member_profiles")
    .update({
      lifetime_xp: lifetimeAfter,
      loyalty_score: lifetimeAfter,
      last_activity_at: new Date().toISOString(),
    })
    .eq("id", member.id);

  if (profileError) throw profileError;

  return { status: "posted", xpAwarded: xpDelta, ledgerIds: ledger?.id ? [ledger.id] : [] };
}

/** Profil CRM member; dibuat dari pos_customers (tier sesuai membership_tier) bila belum ada. */
export async function ensureMemberProfile(db: DbClient, customerId: string): Promise<CrmMemberProfile | null> {
  const existing = await db
    .from("crm_member_profiles")
    .select(PROFILE_WITH_TIER)
    .eq("customer_id", customerId)
    .maybeSingle();

  if (existing.error && !isMissingCrmSchema(existing.error)) throw existing.error;
  if (existing.data) return existing.data as CrmMemberProfile;

  const { data: customer, error: customerError } = await db
    .from("pos_customers")
    .select("id, phone, membership_tier, total_xp, total_spent")
    .eq("id", customerId)
    .maybeSingle();

  if (customerError) throw customerError;
  if (!customer) return null;

  const customerRow = customer as PosCustomerLoyaltyRow;
  const tierCode = String(customerRow.membership_tier || "regular").toLowerCase();
  const tier = (await findTierByCode(db, tierCode)) ?? (await findTierByCode(db, "regular"));
  if (!tier) return null;

  const memberPayload: Record<string, unknown> = {
    customer_id: customerId,
    tier_id: tier.id,
    lifetime_xp: toNumber(customerRow.total_xp),
    loyalty_score: toNumber(customerRow.total_xp),
    status: "active",
    metadata: { enrolled_by: "pos_checkout" },
    last_activity_at: new Date().toISOString(),
  };
  if (customerRow.phone) {
    memberPayload.member_code = `ARK-${String(customerRow.phone).replace(/\D/g, "").slice(-10)}`;
  }

  const { data: inserted, error: insertError } = await db
    .from("crm_member_profiles")
    .insert(memberPayload)
    .select(PROFILE_WITH_TIER)
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      const retry = await db
        .from("crm_member_profiles")
        .select(PROFILE_WITH_TIER)
        .eq("customer_id", customerId)
        .maybeSingle();
      if (retry.error) throw retry.error;
      return retry.data as CrmMemberProfile | null;
    }
    throw insertError;
  }

  return inserted as CrmMemberProfile;
}

async function findTierByCode(db: DbClient, code: string): Promise<CrmTier | null> {
  const { data, error } = await db
    .from("crm_membership_tiers")
    .select("*")
    .eq("code", code)
    .eq("is_active", true)
    .maybeSingle();

  if (error && !isMissingCrmSchema(error)) throw error;
  return (data as CrmTier | null) ?? null;
}

async function getTierMultiplierForRule(db: DbClient, ruleId: string, member: CrmMemberProfile) {
  const { data: rule } = await db
    .from("crm_xp_rules")
    .select("tier_multiplier_enabled")
    .eq("id", ruleId)
    .maybeSingle();

  if (!rule?.tier_multiplier_enabled) return 1;
  return toNumber(member.tier?.xp_multiplier) || 1;
}

type FlatXpInput = {
  customerId: string;
  xpAmount: number;
  companyId?: string | null;
  branchId?: string | null;
  sourceType: string;
  sourceId: string;
  referenceTable: string;
  idempotencyKey: string;
  description: string;
  sourceChannel?: string;
};

/**
 * XP nominal (tanpa multiplier tier) untuk sumber non-order: Free XP profil,
 * hadiah challenge. Idempoten lewat idempotency_key ledger; XP yang terposting
 * disalin ke pos_customers.total_xp lalu tier dievaluasi ulang — sama seperti
 * alur XP order (tanpa ini total_xp customer tidak bergerak).
 */
export async function awardFlatXp(db: DbClient, input: FlatXpInput): Promise<CrmXpAwardResult> {
  const result = await postXpEvent(db, {
    sourceChannel: input.sourceChannel,
    customerId: input.customerId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    companyId: input.companyId ?? null,
    branchId: input.branchId ?? null,
    xpAmount: Math.max(0, Math.floor(input.xpAmount)),
    referenceTable: input.referenceTable,
    referenceId: input.sourceId,
    idempotencyKey: input.idempotencyKey,
    description: input.description,
    applyTierMultiplier: false,
  });

  if (result.status === "posted") {
    await syncAfterEarn(db, input.customerId, result.xpAwarded);
  }
  return result;
}
