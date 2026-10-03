import { query, withTransaction } from "@/lib/db";
import type { PoolClient } from "pg";
import {
  offerCapReason,
  type AppliedOffer,
  type OfferEvalRule,
} from "@/lib/promo/offer-evaluate";
import {
  type OfferRuleInput,
  type OfferType,
  validateOfferRule,
} from "@/lib/promo/offer-rules";

export type OfferRuleRow = {
  id: string;
  company_id: string;
  branch_id: string;
  offer_type: OfferType;
  name: string;
  description: string | null;
  valid_from: string | null;
  valid_until: string | null;
  is_active: boolean;
  bundle_price: string | null;
  buy_qty: number | null;
  get_qty: number | null;
  get_mode: string | null;
  volume_basis: string | null;
  volume_min: string | null;
  discount_type: string | null;
  discount_value: string | null;
  sales_channels: string[] | null;
  max_uses: number | null;
  max_uses_per_member: number | null;
  is_exclusive: boolean;
  priority: number;
  unlock_code: string | null;
  /** Pemakaian hidup (held segar + captured) lintas order. */
  used_count: number;
  /** Pemakaian hidup member yang diminta; 0 tanpa member. */
  member_used_count: number;
  created_at: string;
  updated_at: string;
};

export type OfferRuleItemRow = {
  id: string;
  rule_id: string;
  role: string;
  product_id: string | null;
  category_id: string | null;
  qty: string;
  sort_order: number;
  product_name?: string | null;
  category_name?: string | null;
};

export type OfferRuleDetail = OfferRuleRow & { items: OfferRuleItemRow[] };

/**
 * Pemakaian yang dihitung kuota: captured, atau held yang masih segar.
 * Held lebih tua dari 30 menit = checkout yang gagal di tengah jalan,
 * kedaluwarsa sendiri tanpa perlu dilepas di setiap jalur error.
 */
const LIVE_USAGE = `(u.status = 'captured' OR (u.status = 'held' AND u.created_at > now() - interval '30 minutes'))`;

const RULE_SELECT = `
  SELECT r.id, r.company_id, r.branch_id, r.offer_type, r.name, r.description,
         r.valid_from::text, r.valid_until::text, r.is_active,
         r.bundle_price::text, r.buy_qty, r.get_qty, r.get_mode,
         r.volume_basis, r.volume_min::text, r.discount_type, r.discount_value::text,
         r.sales_channels, r.max_uses, r.max_uses_per_member, r.is_exclusive,
         r.priority, r.unlock_code,
         (SELECT COUNT(*)::int FROM promo.offer_usages u
           WHERE u.rule_id = r.id AND ${LIVE_USAGE}) AS used_count,
         (SELECT COUNT(*)::int FROM promo.offer_usages u
           WHERE u.rule_id = r.id AND u.customer_id = $1::uuid AND ${LIVE_USAGE}) AS member_used_count,
         r.created_at, r.updated_at
  FROM promo.offer_rules r`;

async function attachItems(rules: OfferRuleRow[]): Promise<OfferRuleDetail[]> {
  if (rules.length === 0) return [];
  const items = await query<OfferRuleItemRow>(
    `SELECT i.id, i.rule_id, i.role, i.product_id, i.category_id, i.qty::text,
            i.sort_order, p.name AS product_name, c.name AS category_name
     FROM promo.offer_rule_items i
     LEFT JOIN pos.pos_products p ON p.id = i.product_id
     LEFT JOIN pos.pos_categories c ON c.id = i.category_id
     WHERE i.rule_id = ANY($1::uuid[])
     ORDER BY i.sort_order, i.created_at`,
    [rules.map((r) => r.id)]
  );
  const byRule = new Map<string, OfferRuleItemRow[]>();
  for (const item of items) {
    const list = byRule.get(item.rule_id) ?? [];
    list.push(item);
    byRule.set(item.rule_id, list);
  }
  return rules.map((rule) => ({ ...rule, items: byRule.get(rule.id) ?? [] }));
}

export async function listOfferRules(input: {
  companyId: string;
  branchId: string;
  offerType: OfferType;
}): Promise<OfferRuleDetail[]> {
  const rules = await query<OfferRuleRow>(
    `${RULE_SELECT}
     WHERE r.company_id = $2 AND r.branch_id = $3 AND r.offer_type = $4
     ORDER BY r.priority DESC, r.created_at DESC`,
    [null, input.companyId, input.branchId, input.offerType]
  );
  return attachItems(rules);
}

export async function getOfferRule(input: {
  id: string;
  companyId: string;
  branchId: string;
}): Promise<OfferRuleDetail | null> {
  const rows = await query<OfferRuleRow>(
    `${RULE_SELECT}
     WHERE r.id = $4 AND r.company_id = $2 AND r.branch_id = $3
     LIMIT 1`,
    [null, input.companyId, input.branchId, input.id]
  );
  const [detail] = await attachItems(rows);
  return detail ?? null;
}

async function replaceItems(
  client: PoolClient,
  ruleId: string,
  items: OfferRuleInput["items"]
) {
  await client.query(`DELETE FROM promo.offer_rule_items WHERE rule_id = $1`, [
    ruleId,
  ]);
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]!;
    await client.query(
      `INSERT INTO promo.offer_rule_items
         (rule_id, role, product_id, category_id, qty, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        ruleId,
        item.role,
        item.product_id || null,
        item.category_id || null,
        Number(item.qty) > 0 ? Number(item.qty) : 1,
        item.sort_order ?? i,
      ]
    );
  }
}

/** Nilai kolom aturan sesuai urutan RULE_COLUMNS ($1..$19 di INSERT/UPDATE). */
function ruleColumnValues(p: OfferRuleInput): unknown[] {
  const channels = (p.sales_channels ?? []).filter(Boolean);
  return [
    p.name.trim(),
    p.description?.trim() || null,
    p.valid_from || null,
    p.valid_until || null,
    p.is_active !== false,
    p.bundle_price ?? null,
    p.buy_qty ?? null,
    p.get_qty ?? null,
    p.get_mode ?? null,
    p.volume_basis ?? null,
    p.volume_min ?? null,
    p.discount_type ?? null,
    p.discount_value ?? null,
    channels.length > 0 ? channels : null,
    p.max_uses ?? null,
    p.max_uses_per_member ?? null,
    p.is_exclusive === true,
    p.priority ?? 0,
    p.unlock_code?.trim().toUpperCase() || null,
  ];
}

const RULE_COLUMNS = `name, description, valid_from, valid_until, is_active,
  bundle_price, buy_qty, get_qty, get_mode, volume_basis, volume_min,
  discount_type, discount_value, sales_channels, max_uses,
  max_uses_per_member, is_exclusive, priority, unlock_code`;

/** Input admin ditolak (validasi / kode bentrok) — route memetakan ke 400. */
export class OfferRuleInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OfferRuleInputError";
  }
}

/** Kode pembuka bentrok (unique index) → pesan ramah. */
function mapUniqueViolation(err: unknown): never {
  if ((err as { code?: string }).code === "23505") {
    throw new OfferRuleInputError("Kode pembuka sudah dipakai penawaran lain — pilih kode lain");
  }
  throw err;
}

export async function createOfferRule(input: {
  companyId: string;
  branchId: string;
  userId: string;
  payload: OfferRuleInput;
}): Promise<OfferRuleDetail> {
  const error = validateOfferRule(input.payload);
  if (error) throw new OfferRuleInputError(error);

  const p = input.payload;
  const id = await withTransaction(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO promo.offer_rules (
         ${RULE_COLUMNS}, company_id, branch_id, offer_type, created_by
       ) VALUES (
         $1,$2,$3::date,$4::date,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
         $20,$21,$22,$23
       ) RETURNING id`,
      [...ruleColumnValues(p), input.companyId, input.branchId, p.offer_type, input.userId]
    );
    const ruleId = inserted.rows[0]!.id;
    await replaceItems(client, ruleId, p.items);
    return ruleId;
  }).catch(mapUniqueViolation);

  const detail = await getOfferRule({
    id,
    companyId: input.companyId,
    branchId: input.branchId,
  });
  if (!detail) throw new Error("Gagal memuat aturan yang baru dibuat");
  return detail;
}

export async function updateOfferRule(input: {
  id: string;
  companyId: string;
  branchId: string;
  payload: OfferRuleInput;
}): Promise<OfferRuleDetail> {
  const existing = await getOfferRule({
    id: input.id,
    companyId: input.companyId,
    branchId: input.branchId,
  });
  if (!existing) throw new OfferRuleInputError("Aturan tidak ditemukan");

  const payload: OfferRuleInput = {
    ...input.payload,
    offer_type: existing.offer_type,
  };
  const error = validateOfferRule(payload);
  if (error) throw new OfferRuleInputError(error);

  const assignments = RULE_COLUMNS.split(",")
    .map((column, index) => {
      const name = column.trim();
      const cast = name === "valid_from" || name === "valid_until" ? "::date" : "";
      return `${name} = $${index + 1}${cast}`;
    })
    .join(", ");

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE promo.offer_rules SET ${assignments}, updated_at = now()
       WHERE id = $20 AND company_id = $21 AND branch_id = $22`,
      [...ruleColumnValues(payload), input.id, input.companyId, input.branchId]
    );
    await replaceItems(client, input.id, payload.items);
  }).catch(mapUniqueViolation);

  const detail = await getOfferRule({
    id: input.id,
    companyId: input.companyId,
    branchId: input.branchId,
  });
  if (!detail) throw new Error("Gagal memuat aturan");
  return detail;
}

export async function deleteOfferRule(input: {
  id: string;
  companyId: string;
  branchId: string;
}): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `DELETE FROM promo.offer_rules
     WHERE id = $1 AND company_id = $2 AND branch_id = $3
     RETURNING id`,
    [input.id, input.companyId, input.branchId]
  );
  return rows.length > 0;
}

/**
 * Aturan aktif dalam periode utk kasir (semua tipe). `customerId` mengisi
 * member_used_count supaya kuota per member terevaluasi sama di klien &
 * server.
 */
export async function listActiveOfferRules(input: {
  companyId: string;
  branchId: string;
  todayIsoDate: string;
  customerId?: string | null;
}): Promise<OfferRuleDetail[]> {
  const rules = await query<OfferRuleRow>(
    `${RULE_SELECT}
     WHERE r.company_id = $2
       AND r.branch_id = $3
       AND r.is_active = true
       AND (r.valid_from IS NULL OR r.valid_from <= $4::date)
       AND (r.valid_until IS NULL OR r.valid_until >= $4::date)
     ORDER BY r.offer_type, r.priority DESC, r.created_at DESC`,
    [input.customerId || null, input.companyId, input.branchId, input.todayIsoDate]
  );
  return attachItems(rules);
}

/** Anggota setiap kategori yang dirujuk aturan (utk expandCategoryTargets). */
export async function loadCategoryProductMap(
  details: OfferRuleDetail[]
): Promise<Map<string, string[]>> {
  const categoryIds = [
    ...new Set(
      details.flatMap((rule) =>
        rule.items.map((item) => item.category_id).filter((id): id is string => Boolean(id))
      )
    ),
  ];
  const map = new Map<string, string[]>();
  if (categoryIds.length === 0) return map;
  const rows = await query<{ id: string; category_id: string }>(
    `SELECT id, category_id FROM pos.pos_products WHERE category_id = ANY($1::uuid[])`,
    [categoryIds]
  );
  for (const row of rows) {
    const list = map.get(row.category_id) ?? [];
    list.push(row.id);
    map.set(row.category_id, list);
  }
  return map;
}

/** Penawaran aktif yang dibuka oleh kode ini (case-insensitive), atau null. */
export async function findOfferByUnlockCode(input: {
  companyId: string;
  branchId: string;
  code: string;
  todayIsoDate: string;
}): Promise<{ id: string; name: string } | null> {
  const code = input.code.trim();
  if (!code) return null;
  const rows = await query<{ id: string; name: string }>(
    `SELECT id, name FROM promo.offer_rules
     WHERE company_id = $1 AND branch_id = $2
       AND unlock_code IS NOT NULL AND upper(unlock_code) = upper($3)
       AND is_active = true
       AND (valid_from IS NULL OR valid_from <= $4::date)
       AND (valid_until IS NULL OR valid_until >= $4::date)
     LIMIT 1`,
    [input.companyId, input.branchId, code, input.todayIsoDate]
  );
  return rows[0] ?? null;
}

export function toOfferEvalRules(details: OfferRuleDetail[]): OfferEvalRule[] {
  return details.map((rule) => ({
    id: rule.id,
    offer_type: rule.offer_type,
    name: rule.name,
    description: rule.description,
    bundle_price: rule.bundle_price != null ? Number(rule.bundle_price) : null,
    buy_qty: rule.buy_qty,
    get_qty: rule.get_qty,
    get_mode:
      rule.get_mode === "same_as_buy" || rule.get_mode === "specific_products"
        ? rule.get_mode
        : null,
    volume_basis:
      rule.volume_basis === "qty" || rule.volume_basis === "spend"
        ? rule.volume_basis
        : null,
    volume_min: rule.volume_min != null ? Number(rule.volume_min) : null,
    discount_type:
      rule.discount_type === "percent" || rule.discount_type === "fixed"
        ? rule.discount_type
        : null,
    discount_value:
      rule.discount_value != null ? Number(rule.discount_value) : null,
    sales_channels: rule.sales_channels,
    requires_code: Boolean(rule.unlock_code),
    is_exclusive: rule.is_exclusive,
    priority: rule.priority,
    max_uses: rule.max_uses,
    used_count: Number(rule.used_count) || 0,
    max_uses_per_member: rule.max_uses_per_member,
    member_used_count: Number(rule.member_used_count) || 0,
    items: rule.items.map((item) => ({
      role: item.role as "component" | "buy" | "get" | "eligible",
      product_id: item.product_id ?? "",
      category_id: item.category_id,
      qty: Number(item.qty) || 1,
    })),
  }));
}

// ── Kuota pemakaian (promo.offer_usages) ────────────────────────────────

export class OfferCapReachedError extends Error {
  statusCode = 422 as const;
  constructor(offerName: string) {
    super(`Kuota penawaran "${offerName}" sudah habis — muat ulang keranjang`);
    this.name = "OfferCapReachedError";
  }
}

type QueryRunner = Pick<PoolClient, "query">;

/**
 * Catat pemakaian penawaran utk satu order DI DALAM transaksi pemanggil.
 * `enforce` = kunci per aturan (advisory lock) → hitung live → tolak bila
 * kuota habis (OfferCapReachedError, 422). Tanpa enforce (open bill yang
 * barisnya sudah tersimpan) hanya mencatat. Idempoten per (rule, order).
 */
export async function recordOfferUsage(
  client: QueryRunner,
  input: {
    companyId: string | null;
    branchId: string | null;
    orderId: string;
    customerId: string | null;
    applied: AppliedOffer[];
    status: "held" | "captured";
    enforce: boolean;
  }
): Promise<void> {
  // Urutan tetap supaya dua order yang memakai aturan sama tidak deadlock
  const applied = [...input.applied].sort((a, b) => a.rule_id.localeCompare(b.rule_id));
  for (const offer of applied) {
    if (input.enforce) {
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext('offer'), hashtext($1::text))`,
        [offer.rule_id]
      );
      const rows = await client.query<{
        max_uses: number | null;
        max_uses_per_member: number | null;
        used_count: number;
        member_used_count: number;
      }>(
        `SELECT r.max_uses, r.max_uses_per_member,
                (SELECT COUNT(*)::int FROM promo.offer_usages u
                  WHERE u.rule_id = r.id AND ${LIVE_USAGE}) AS used_count,
                (SELECT COUNT(*)::int FROM promo.offer_usages u
                  WHERE u.rule_id = r.id AND u.customer_id = $2::uuid AND ${LIVE_USAGE}) AS member_used_count
         FROM promo.offer_rules r WHERE r.id = $1`,
        [offer.rule_id, input.customerId]
      );
      const caps = rows.rows[0];
      if (caps && offerCapReason(caps) !== null) {
        throw new OfferCapReachedError(offer.name);
      }
    }
    await client.query(
      `INSERT INTO promo.offer_usages
         (company_id, branch_id, rule_id, order_id, customer_id, discount_amount, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (rule_id, order_id) DO NOTHING`,
      [
        input.companyId,
        input.branchId,
        offer.rule_id,
        input.orderId,
        input.customerId,
        offer.discount,
        input.status,
      ]
    );
  }
}

/** held → captured (order lunas). Idempoten. */
export async function captureOfferUsage(runner: QueryRunner, orderId: string) {
  await runner.query(
    `UPDATE promo.offer_usages SET status = 'captured', updated_at = now()
     WHERE order_id = $1 AND status = 'held'`,
    [orderId]
  );
}

/** Void order → kuota kembali. Idempoten. */
export async function releaseOfferUsage(runner: QueryRunner, orderId: string) {
  await runner.query(
    `UPDATE promo.offer_usages SET status = 'released', updated_at = now()
     WHERE order_id = $1 AND status <> 'released'`,
    [orderId]
  );
}
