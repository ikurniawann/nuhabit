import "server-only";
/**
 * Detail member CRM (profil + customer POS + ledger XP + order terakhir) dan
 * penyuntingannya. Id URL bisa id profil, id customer, atau "pos-<customerId>".
 */
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { createPgClient } from "@/lib/pg/create-client";
import type { DbClient } from "@/lib/pg/types";
import {
  normalizeCustomer,
  POS_CUSTOMER_COLUMNS,
  profileFields,
  syntheticMemberBase,
  type CustomerRow,
  type MemberProfileRow,
} from "./member-rows";
import { isMissingCrmSchema, toNumber } from "./server";

/** Detail juga memuat flag KOL supaya form edit tidak menimpanya dengan nilai kosong. */
const DETAIL_CUSTOMER_COLUMNS = `${POS_CUSTOMER_COLUMNS}, is_kol, kol_monthly_limit_idr`;
const DETAIL_PROFILE_SELECT =
  "*, tier:crm_membership_tiers(id, code, name, rank, xp_multiplier, discount_percent, min_lifetime_xp, min_total_spend)";
const UUID_V1_5 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type LedgerRow = {
  id: string;
  direction: string;
  source_channel: string;
  source_type: string;
  source_id: string | null;
  xp_delta: number | string;
  balance_after: number | string;
  description: string | null;
  reference_table: string | null;
  reference_id: string | null;
  created_at: string;
};

function detailCustomer(customer: CustomerRow) {
  return {
    ...normalizeCustomer(customer),
    is_kol: customer.is_kol === true,
    kol_monthly_limit_idr: customer.kol_monthly_limit_idr == null ? null : toNumber(customer.kol_monthly_limit_idr),
  };
}

function detailMember(profile: MemberProfileRow, customer: CustomerRow | null) {
  return { ...profileFields(profile), customer: customer ? detailCustomer(customer) : null };
}

function syntheticDetailMember(customer: CustomerRow) {
  const normalized = detailCustomer(customer);
  return {
    ...syntheticMemberBase(normalized),
    active_avatar_id: null,
    joined_at: null,
    last_activity_at: null,
    status: normalized.is_active ? "active" : "inactive",
    metadata: {},
    customer: normalized,
  };
}

const customerIdOf = (id: string) => (id.startsWith("pos-") ? id.replace("pos-", "") : id);

/** Profil CRM by id profil / id customer; 409 bila skema CRM belum aktif. */
async function findProfile(db: DbClient, id: string): Promise<MemberProfileRow | null> {
  const { data, error } = await db
    .from("crm_member_profiles")
    .select(DETAIL_PROFILE_SELECT)
    .or(`id.eq.${id},customer_id.eq.${id}`)
    .maybeSingle();
  if (error) {
    if (isMissingCrmSchema(error)) throw ApiError.conflict("CRM schema belum aktif");
    throw error;
  }
  return (data as MemberProfileRow | null) ?? null;
}

async function findCustomer(db: DbClient, customerId: string) {
  const { data, error } = await db.from("pos_customers").select(DETAIL_CUSTOMER_COLUMNS).eq("id", customerId).maybeSingle();
  return { customer: data as CustomerRow | null, error };
}

async function recentOrders(db: DbClient, customerId: string) {
  const { data } = await db
    .from("pos_orders")
    .select("id, order_number, total_amount, payment_status, status, ordered_at")
    .eq("customer_id", customerId)
    .order("ordered_at", { ascending: false })
    .limit(10);
  return data ?? [];
}

/** Customer tanpa profil CRM; 404 bila customer juga tidak ada. */
async function syntheticDetail(db: DbClient, customerId: string) {
  const { customer, error } = await findCustomer(db, customerId);
  if (error) throw error;
  if (!customer) throw ApiError.notFound("Member tidak ditemukan");
  return { member: syntheticDetailMember(customer), xpLedger: [], recentOrders: await recentOrders(db, customerId) };
}

/** Detail lengkap: profil + customer + 50 ledger XP + 10 order terakhir. */
export async function loadMemberDetail(id: string) {
  const db = createPgClient();
  if (!UUID_V1_5.test(id)) return syntheticDetail(db, customerIdOf(id));

  const profile = await findProfile(db, id);
  if (!profile) return syntheticDetail(db, customerIdOf(id));

  const { customer } = await findCustomer(db, profile.customer_id);
  const { data: ledgerRows, error: ledgerError } = await db
    .from("crm_xp_ledger")
    .select("id, direction, source_channel, source_type, source_id, xp_delta, balance_after, description, reference_table, reference_id, created_at")
    .eq("member_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (ledgerError) throw ledgerError;

  return {
    member: detailMember(profile, customer),
    xpLedger: ((ledgerRows ?? []) as LedgerRow[]).map((row) => ({
      ...row,
      xp_delta: toNumber(row.xp_delta),
      balance_after: toNumber(row.balance_after),
    })),
    recentOrders: await recentOrders(db, profile.customer_id),
  };
}

export const updateMemberSchema = z.object({
  customer: z.object({
    name: z.string().trim().min(1).max(160).optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    email: z.string().trim().email().or(z.literal("")).nullable().optional(),
    is_active: z.boolean().optional(),
    /** EPIC-043 — flag KOL + kuota komplimen bulanan (Rp gross; null = tanpa batas). */
    is_kol: z.boolean().optional(),
    kol_monthly_limit_idr: z.number().nonnegative().max(999_999_999).nullable().optional(),
  }).optional(),
  member: z.object({
    tier_id: z.string().uuid().optional(),
    status: z.enum(["active", "inactive", "suspended", "merged"]).optional(),
  }).optional(),
});

type CustomerPayload = NonNullable<z.infer<typeof updateMemberSchema>["customer"]>;

/** Kolom pos_customers yang diubah: email yang tidak dikirim tetap, "" atau null mengosongkannya. */
export function customerPatch({ email, ...rest }: CustomerPayload) {
  return email === undefined ? rest : { ...rest, email: email === "" ? null : email };
}

/**
 * Ubah data customer dan/atau profil member; ganti tier ikut menyalin kode
 * tier ke pos_customers. Mengembalikan member terbaru (tanpa ledger/order).
 */
export async function updateMemberDetail(id: string, payload: z.infer<typeof updateMemberSchema>) {
  const db = createPgClient();
  const profile = UUID_V1_5.test(id) ? await findProfile(db, id) : null;
  const customerId = profile?.customer_id ?? customerIdOf(id);

  if (payload.customer && Object.keys(payload.customer).length > 0) {
    const { error } = await db
      .from("pos_customers")
      .update(customerPatch(payload.customer))
      .eq("id", customerId);
    if (error) throw error;
  }

  if (payload.member && profile) {
    const { error } = await db
      .from("crm_member_profiles")
      .update({ ...payload.member, last_activity_at: new Date().toISOString() })
      .eq("id", profile.id);
    if (error) throw error;
  }

  if (payload.member?.tier_id) {
    const { data: tier } = await db.from("crm_membership_tiers").select("code").eq("id", payload.member.tier_id).maybeSingle();
    const code = (tier as { code?: string } | null)?.code;
    if (code) await db.from("pos_customers").update({ membership_tier: code }).eq("id", customerId);
  }

  const detailId = profile?.id ?? (id.startsWith("pos-") ? id : customerId);
  if (!UUID_V1_5.test(detailId)) return syntheticDetail(db, customerIdOf(detailId));
  const updated = await findProfile(db, detailId);
  if (!updated) return syntheticDetail(db, customerIdOf(detailId));
  const { customer } = await findCustomer(db, updated.customer_id);
  return { member: detailMember(updated, customer) };
}
