import "server-only";
// EPIC-032 Fase A2 — sisi server engine promo: preview validasi (read-only)
// dan siklus hidup pemakaian kode: HOLD (klaim transaksional di bawah
// advisory lock) → CAPTURE (terpakai final) → RELEASE (lepas + kembalikan
// jatah). Pola anti-race = EPIC-031: lock → hitung live → putuskan; lock
// per CAMPAIGN karena limit campaign melintasi banyak kode (batch voucher).

import type { PoolClient } from "pg";
import { query } from "@/lib/db";
import {
  PROMO_REJECT_MESSAGES,
  evaluatePromo,
  hasPromoTargets,
  type PromoCampaignRule,
  type PromoCodeState,
  type PromoEligibility,
  type PromoLine,
  type PromoMemberContext,
  type PromoRejectReason,
  type PromoScope,
} from "./promo";

type Runner = <T>(sql: string, params: unknown[]) => Promise<T[]>;

export interface PromoVenueScope {
  companyId: string;
  branchId: string;
}

export type PromoChannel = Exclude<PromoScope, "semua">;

export type PromoContextType = "ticket_booking" | "pos_order";

/** Baris gabungan kode + campaign hasil lookup. */
export interface PromoCodeRow {
  code_id: string;
  code: string;
  code_usage_limit: number | null;
  code_usage_count: number;
  code_is_active: boolean;
  campaign_id: string;
  campaign_name: string;
  discount_type: "percent" | "fixed";
  value: number;
  max_discount: number | null;
  min_purchase: number;
  valid_from: string | null;
  valid_until: string | null;
  usage_limit: number | null;
  per_phone_limit: number | null;
  scope: PromoScope;
  campaign_is_active: boolean;
  target_product_ids: string[];
  target_category_ids: string[];
  eligibility: PromoEligibility;
  new_member_days: number | null;
}

/** Baris keranjang dari pemanggil — kategori dimuat ulang dari katalog. */
export interface PromoLineInput {
  productId: string;
  amount: number;
}

/** Error ber-statusCode — pola staff-passes/CapacityFullError. */
export class PromoRejectedError extends Error {
  statusCode = 422 as const;
  reason: PromoRejectReason;
  constructor(reason: PromoRejectReason) {
    super(PROMO_REJECT_MESSAGES[reason]);
    this.name = "PromoRejectedError";
    this.reason = reason;
  }
}

const todayJakartaDate = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(
    new Date()
  );

const CODE_JOIN_SELECT = `
  SELECT k.id AS code_id, k.code, k.usage_limit AS code_usage_limit,
         k.usage_count AS code_usage_count, k.is_active AS code_is_active,
         c.id AS campaign_id, c.name AS campaign_name, c.discount_type,
         c.value::float8 AS value, c.max_discount::float8 AS max_discount,
         c.min_purchase::float8 AS min_purchase,
         c.valid_from::text AS valid_from, c.valid_until::text AS valid_until,
         c.usage_limit, c.per_phone_limit, c.scope,
         c.is_active AS campaign_is_active,
         c.target_product_ids::text[] AS target_product_ids,
         c.target_category_ids::text[] AS target_category_ids,
         c.eligibility, c.new_member_days
  FROM promo.promo_codes k
  JOIN promo.promo_campaigns c ON c.id = k.campaign_id`;

/** Lookup kode per venue — case-insensitive (kode disimpan apa adanya). */
async function findCodeRows(
  scope: PromoVenueScope,
  code: string,
  runner: Runner
): Promise<PromoCodeRow | null> {
  const rows = await runner<PromoCodeRow>(
    `${CODE_JOIN_SELECT}
     WHERE k.branch_id = $1 AND k.company_id = $2 AND upper(k.code) = upper($3)
     LIMIT 1`,
    [scope.branchId, scope.companyId, code.trim()]
  );
  return rows[0] ?? null;
}

const toRule = (row: PromoCodeRow): PromoCampaignRule => ({
  discount_type: row.discount_type,
  value: row.value,
  max_discount: row.max_discount,
  min_purchase: row.min_purchase,
  valid_from: row.valid_from,
  valid_until: row.valid_until,
  usage_limit: row.usage_limit,
  per_phone_limit: row.per_phone_limit,
  scope: row.scope,
  is_active: row.campaign_is_active,
  target_product_ids: row.target_product_ids ?? [],
  target_category_ids: row.target_category_ids ?? [],
  eligibility: row.eligibility ?? "semua",
  new_member_days: row.new_member_days,
});

/** Lengkapi baris dgn kategori katalog — hanya bila campaign punya target. */
async function resolvePromoLines(
  row: PromoCodeRow,
  lines: PromoLineInput[] | undefined,
  runner: Runner
): Promise<PromoLine[] | undefined> {
  if (!lines || !hasPromoTargets(toRule(row))) return undefined;
  const ids = [...new Set(lines.map((l) => l.productId).filter(Boolean))];
  const rows = ids.length
    ? await runner<{ id: string; category_id: string | null }>(
        `SELECT id, category_id FROM pos.pos_products WHERE id = ANY($1::uuid[])`,
        [ids]
      )
    : [];
  const categoryOf = new Map(rows.map((r) => [r.id, r.category_id]));
  return lines.map((line) => ({
    productId: line.productId,
    categoryId: categoryOf.get(line.productId) ?? null,
    amount: line.amount,
  }));
}

/**
 * Riwayat member utk syarat kelayakan. Order void/batal/merge tidak
 * dihitung sebagai transaksi lunas. Hanya dimuat bila campaign memerlukan.
 */
async function loadPromoMemberContext(
  row: PromoCodeRow,
  customerId: string | null | undefined,
  runner: Runner
): Promise<PromoMemberContext | null> {
  if (!customerId || row.eligibility === "semua") return null;
  const rows = await runner<{ prior_paid: string; joined_days: string }>(
    `SELECT
       (SELECT COUNT(*) FROM pos.pos_orders o
         WHERE o.customer_id = c.id AND o.payment_status = 'paid'
           AND o.status NOT IN ('voided', 'cancelled', 'merged')) AS prior_paid,
       FLOOR(EXTRACT(EPOCH FROM (now() - c.created_at)) / 86400) AS joined_days
     FROM pos.pos_customers c WHERE c.id = $1`,
    [customerId]
  );
  const found = rows[0];
  if (!found) return null;
  return {
    priorPaidOrders: Number(found.prior_paid) || 0,
    joinedDaysAgo: Number(found.joined_days) || 0,
  };
}

const toCodeState = (row: PromoCodeRow): PromoCodeState => ({
  is_active: row.code_is_active,
  usage_limit: row.code_usage_limit,
  usage_count: row.code_usage_count,
});

/** Hitungan hidup (held/captured) — dipanggil DI BAWAH lock utk jalur tulis. */
async function loadUsageCounts(
  campaignId: string,
  phone: string | null,
  runner: Runner
): Promise<{ campaignUsed: number; phoneUsed: number }> {
  const rows = await runner<{ campaign_used: string; phone_used: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE status <> 'released') AS campaign_used,
       COUNT(*) FILTER (WHERE status <> 'released' AND phone = $2) AS phone_used
     FROM promo.promo_redemptions
     WHERE campaign_id = $1`,
    [campaignId, phone]
  );
  return {
    campaignUsed: Number(rows[0]?.campaign_used ?? 0),
    phoneUsed: Number(rows[0]?.phone_used ?? 0),
  };
}

export type PromoPreview =
  | {
      ok: true;
      discount: number;
      campaign_name: string;
      discount_type: "percent" | "fixed";
    }
  | { ok: false; reason: PromoRejectReason; message: string };

/**
 * Preview READ-ONLY utk endpoint validasi (wizard/kasir): tanpa lock,
 * tanpa klaim — indikatif; kebenaran final tetap `holdPromoRedemption`
 * di dalam transaksi create. Kode tak dikenal = pesan sama dgn nonaktif
 * (anti-enumerasi kode).
 */
export async function previewPromoCode(input: {
  scope: PromoVenueScope;
  code: string;
  channel: PromoChannel;
  subtotal: number;
  phone: string | null;
  lines?: PromoLineInput[];
  customerId?: string | null;
}): Promise<PromoPreview> {
  const poolRunner = <T>(sql: string, params: unknown[]) =>
    query<T & Record<string, unknown>>(sql, params) as Promise<T[]>;
  const row = await findCodeRows(input.scope, input.code, poolRunner);
  if (!row) {
    return {
      ok: false,
      reason: "nonaktif",
      message: PROMO_REJECT_MESSAGES["nonaktif"],
    };
  }
  const counts = await loadUsageCounts(row.campaign_id, input.phone, poolRunner);
  const result = evaluatePromo(toRule(row), toCodeState(row), {
    today: todayJakartaDate(),
    channel: input.channel,
    subtotal: input.subtotal,
    campaignUsedCount: counts.campaignUsed,
    phoneUsedCount: counts.phoneUsed,
    lines: await resolvePromoLines(row, input.lines, poolRunner),
    member: await loadPromoMemberContext(row, input.customerId, poolRunner),
  });
  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason,
      message: PROMO_REJECT_MESSAGES[result.reason],
    };
  }
  return {
    ok: true,
    discount: result.discount,
    campaign_name: row.campaign_name,
    discount_type: row.discount_type,
  };
}

export interface PromoHold {
  redemptionId: string;
  codeId: string;
  campaignName: string;
  discount: number;
}

/**
 * Klaim kode DI DALAM transaksi pemanggil: advisory lock per campaign →
 * muat ulang kode+campaign → hitung pemakaian live → evaluasi → naikkan
 * usage_count + insert redemption `held`. Throw PromoRejectedError (422)
 * bila tak lolos. Unique index context = backstop 1 kode per transaksi.
 */
export async function holdPromoRedemption(
  client: PoolClient,
  input: {
    scope: PromoVenueScope;
    code: string;
    channel: PromoChannel;
    contextType: PromoContextType;
    contextId: string;
    subtotal: number;
    phone: string | null;
    customerId?: string | null;
    lines?: PromoLineInput[];
  }
): Promise<PromoHold> {
  const clientRunner = <T>(sql: string, params: unknown[]) =>
    client.query<T & Record<string, unknown>>(sql, params).then((r) => r.rows as T[]);

  // Lookup awal hanya utk tahu campaign_id (kunci lock)
  const initial = await findCodeRows(input.scope, input.code, clientRunner);
  if (!initial) throw new PromoRejectedError("nonaktif");

  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext('promo'), hashtext($1::text))`,
    [initial.campaign_id]
  );

  // Muat ULANG di bawah lock — usage_count/status bisa berubah
  const row = await findCodeRows(input.scope, input.code, clientRunner);
  if (!row) throw new PromoRejectedError("nonaktif");

  const counts = await loadUsageCounts(row.campaign_id, input.phone, clientRunner);
  const result = evaluatePromo(toRule(row), toCodeState(row), {
    today: todayJakartaDate(),
    channel: input.channel,
    subtotal: input.subtotal,
    campaignUsedCount: counts.campaignUsed,
    phoneUsedCount: counts.phoneUsed,
    lines: await resolvePromoLines(row, input.lines, clientRunner),
    member: await loadPromoMemberContext(row, input.customerId, clientRunner),
  });
  if (!result.ok) throw new PromoRejectedError(result.reason);

  await client.query(
    `UPDATE promo.promo_codes
     SET usage_count = usage_count + 1, updated_at = now()
     WHERE id = $1`,
    [row.code_id]
  );
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO promo.promo_redemptions
       (company_id, branch_id, code_id, campaign_id, campaign_name,
        discount_type, value, context_type, context_id, phone, customer_id,
        discount_amount, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'held')
     RETURNING id`,
    [
      input.scope.companyId,
      input.scope.branchId,
      row.code_id,
      row.campaign_id,
      row.campaign_name,
      row.discount_type,
      row.value,
      input.contextType,
      input.contextId,
      input.phone,
      input.customerId ?? null,
      result.discount,
    ]
  );
  return {
    redemptionId: inserted.rows[0].id,
    codeId: row.code_id,
    campaignName: row.campaign_name,
    discount: result.discount,
  };
}

type QueryRunner = Pick<PoolClient, "query">;

/**
 * Tandai pemakaian FINAL (mis. webhook PAID). Idempoten: hanya baris
 * `held` yang berubah. Return true bila ada yang berubah.
 */
export async function capturePromoRedemption(
  runner: QueryRunner,
  contextType: PromoContextType,
  contextId: string
): Promise<boolean> {
  const result = await runner.query(
    `UPDATE promo.promo_redemptions
     SET status = 'captured', updated_at = now()
     WHERE context_type = $1 AND context_id = $2 AND status = 'held'`,
    [contextType, contextId]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Lepas pemakaian (kedaluwarsa/batal/void) + kembalikan jatah kode.
 * Idempoten: baris `released` tidak disentuh ulang; usage_count dijaga
 * tidak minus (GREATEST). Return true bila ada yang dilepas.
 */
export async function releasePromoRedemption(
  runner: QueryRunner,
  contextType: PromoContextType,
  contextId: string
): Promise<boolean> {
  const released = await runner.query<{ code_id: string }>(
    `UPDATE promo.promo_redemptions
     SET status = 'released', updated_at = now()
     WHERE context_type = $1 AND context_id = $2 AND status <> 'released'
     RETURNING code_id`,
    [contextType, contextId]
  );
  for (const row of released.rows) {
    await runner.query(
      `UPDATE promo.promo_codes
       SET usage_count = GREATEST(usage_count - 1, 0), updated_at = now()
       WHERE id = $1`,
      [row.code_id]
    );
  }
  return released.rows.length > 0;
}
