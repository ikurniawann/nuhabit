import "server-only";
/** Daftar member CRM (dengan fallback customer POS) dan enrol member baru. */
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { createPgClient } from "@/lib/pg/create-client";
import {
  normalizeCustomer,
  POS_CUSTOMER_COLUMNS,
  profileFields,
  syntheticMemberBase,
  type CustomerRow,
  type MemberProfileRow,
  type TierRow,
} from "./member-rows";
import { crmSchemaError } from "./guards";
import { isMissingCrmSchema, toNumber } from "./server";

const PROFILE_SELECT = "*, tier:crm_membership_tiers(id, code, name, rank, xp_multiplier, discount_percent)";

function listMember(profile: MemberProfileRow, customer?: CustomerRow) {
  return {
    ...profileFields(profile),
    source: "crm_member_profiles",
    customer: customer ? normalizeCustomer(customer) : null,
  };
}

function syntheticListMember(customer: CustomerRow) {
  const normalized = normalizeCustomer(customer);
  return {
    ...syntheticMemberBase(normalized),
    status: normalized.is_active ? "active" : "inactive",
    source: "pos_customers",
    customer: normalized,
  };
}

export type MemberListFilter = { search: string | null; tier: string | null; limit: string | null };

/**
 * Member CRM urut lifetime XP. Pencarian mencakup kode member dan
 * nama/telepon/email customer (temuan audit EPIC-011 Fase A). Skema CRM
 * belum ada → customer POS sebagai member sintetis (schemaReady false).
 */
export async function listMembers(filter: MemberListFilter) {
  const db = createPgClient();
  const { search, tier } = filter;
  const limit = Math.min(Number(filter.limit || 50), 200);
  const customerSearch = search ? `name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%` : null;

  let tierId: string | null = null;
  if (tier) {
    const { data: tierRow, error: tierError } = await db
      .from("crm_membership_tiers")
      .select("id")
      .eq("code", tier)
      .maybeSingle();
    if (tierError && !isMissingCrmSchema(tierError)) throw tierError;
    tierId = (tierRow as { id?: string } | null)?.id ?? null;
  }

  const buildProfileQuery = () => {
    let query = db.from("crm_member_profiles").select(PROFILE_SELECT).order("lifetime_xp", { ascending: false }).limit(limit);
    if (tierId) query = query.eq("tier_id", tierId);
    return query;
  };

  /** Customer POS aktif sebagai member sintetis. */
  const customerFallback = async (orderBy: "total_xp" | "total_spent") => {
    let customerQuery = db
      .from("pos_customers")
      .select(POS_CUSTOMER_COLUMNS)
      .eq("is_active", true)
      .order(orderBy, { ascending: false })
      .limit(limit);
    if (customerSearch) customerQuery = customerQuery.or(customerSearch);
    if (tier) customerQuery = customerQuery.eq("membership_tier", tier);
    const { data: customers, error: customerError } = await customerQuery;
    if (customerError) throw customerError;
    return ((customers ?? []) as CustomerRow[]).map(syntheticListMember);
  };

  let profiles: MemberProfileRow[] | null = null;
  let profileError: unknown = null;

  if (customerSearch) {
    const { data: matchedCustomers } = await db.from("pos_customers").select("id").or(customerSearch).limit(200);
    const matchedIds = ((matchedCustomers ?? []) as Array<{ id: string }>).map((row) => row.id);

    const byCode = await buildProfileQuery().ilike("member_code", `%${search}%`);
    if (byCode.error) {
      profileError = byCode.error;
    } else {
      const merged = new Map<string, MemberProfileRow>();
      for (const row of (byCode.data ?? []) as MemberProfileRow[]) merged.set(row.id, row);
      if (matchedIds.length > 0) {
        const byCustomer = await buildProfileQuery().in("customer_id", matchedIds);
        if (byCustomer.error) profileError = byCustomer.error;
        else for (const row of (byCustomer.data ?? []) as MemberProfileRow[]) merged.set(row.id, row);
      }
      if (!profileError) {
        profiles = [...merged.values()]
          .sort((a, b) => toNumber(b.lifetime_xp) - toNumber(a.lifetime_xp))
          .slice(0, limit);
      }
    }
  } else {
    const result = await buildProfileQuery();
    profiles = result.data as MemberProfileRow[] | null;
    profileError = result.error;
  }

  if (profileError) {
    if (!isMissingCrmSchema(profileError)) throw profileError;
    return { data: await customerFallback("total_xp"), schemaReady: false };
  }

  const rows = profiles ?? [];
  if (rows.length === 0) return { data: await customerFallback("total_spent"), schemaReady: true };

  const { data: customers } = await db
    .from("pos_customers")
    .select(POS_CUSTOMER_COLUMNS)
    .in("id", rows.map((profile) => profile.customer_id));
  const customersById = new Map(((customers ?? []) as CustomerRow[]).map((customer) => [customer.id, customer]));

  return {
    data: rows.map((profile) => listMember(profile, customersById.get(profile.customer_id))),
    schemaReady: true,
  };
}

export const enrollMemberSchema = z.object({
  customer_id: z.string().uuid(),
  tier_code: z.string().trim().min(1).max(40).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

/** Enrol customer POS sebagai member CRM (tier diminta, fallback regular). */
export async function enrollMember(payload: z.infer<typeof enrollMemberSchema>) {
  const db = createPgClient();
  const { data: customer, error: customerError } = await db
    .from("pos_customers")
    .select(POS_CUSTOMER_COLUMNS)
    .eq("id", payload.customer_id)
    .maybeSingle();
  if (customerError) throw customerError;
  if (!customer) throw ApiError.notFound("Customer tidak ditemukan");

  const customerRow = customer as CustomerRow;
  const requestedTierCode = String(payload.tier_code ?? customerRow.membership_tier ?? "regular").toLowerCase();
  const { data: requestedTier, error: tierError } = await db
    .from("crm_membership_tiers")
    .select("id, code, name, rank")
    .eq("code", requestedTierCode)
    .maybeSingle();
  if (tierError) throw crmSchemaError(tierError);

  let tier = requestedTier;
  if (!tier && requestedTierCode !== "regular") {
    const fallback = await db.from("crm_membership_tiers").select("id, code, name, rank").eq("code", "regular").maybeSingle();
    if (fallback.error) throw fallback.error;
    tier = fallback.data;
  }
  if (!tier) throw ApiError.notFound("Tier CRM tidak ditemukan");

  const normalizedCustomer = normalizeCustomer(customerRow);
  const { data: profile, error: profileError } = await db
    .from("crm_member_profiles")
    .upsert(
      {
        customer_id: payload.customer_id,
        tier_id: (tier as TierRow).id,
        lifetime_xp: normalizedCustomer.total_xp,
        loyalty_score: normalizedCustomer.total_xp,
        status: "active",
        metadata: payload.metadata,
        last_activity_at: new Date().toISOString(),
      },
      { onConflict: "customer_id" }
    )
    .select(PROFILE_SELECT)
    .single();
  if (profileError) throw profileError;

  return listMember(profile as MemberProfileRow, customerRow);
}
