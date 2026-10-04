import type { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import type { UserScope } from "@/lib/api/scope";
import { loadExistingCustom } from "@/lib/crm/custom-fields-server";
import { query, queryOne } from "@/lib/db";
import type { accountSchema, updateAccountSchema } from "./accounts";
import {
  ACCOUNT_TYPES,
  assertOwnerAssignable,
  requireValidPhone,
  resolveCustomValues,
  type SalesFunnelUser,
} from "./server";
import { createUpdateSet, createWhere, isUuid, parsePagination, splitTotalCount } from "./sql";

/**
 * EPIC-050 Fase 1 (T-1.3) — Accounts: instansi/perusahaan B2B. Kolom agregat
 * (contact/lead/deal terbuka, nilai menang) lewat subquery skalar agar satu
 * account = satu baris.
 */
const ACCOUNT_COLUMNS = `
  a.id, a.company_id, a.branch_id, a.name, a.account_type, a.industry,
  a.address, a.city, a.phone, a.email, a.website, a.npwp, a.notes,
  a.owner_user_id, a.custom, a.created_at, a.updated_at,
  u.full_name AS owner_name,
  (SELECT count(*) FROM crm.crm_contacts c WHERE c.account_id = a.id AND c.deleted_at IS NULL)::int AS contact_count,
  (SELECT count(*) FROM crm.crm_sales_leads l WHERE l.account_id = a.id AND l.deleted_at IS NULL)::int AS lead_count,
  (SELECT count(*) FROM crm.crm_sales_deals d JOIN crm.crm_sales_leads l ON l.id = d.lead_id
     WHERE l.account_id = a.id AND d.deleted_at IS NULL AND d.closed_at IS NULL)::int AS open_deal_count,
  (SELECT COALESCE(sum(COALESCE(d.value_final, d.value_estimate)), 0)
     FROM crm.crm_sales_deals d JOIN crm.crm_sales_stages s ON s.id = d.stage_id
     JOIN crm.crm_sales_leads l ON l.id = d.lead_id
     WHERE l.account_id = a.id AND d.deleted_at IS NULL AND s.is_won)::numeric AS won_value,
  (SELECT max(COALESCE(act.done_at, act.created_at)) FROM crm.crm_sales_activities act
     WHERE act.deleted_at IS NULL AND act.subject_type = 'account' AND act.subject_id = a.id) AS last_activity_at`;

export async function listAccounts(user: SalesFunnelUser, scope: UserScope | null, searchParams: URLSearchParams) {
  const q = searchParams.get("q")?.trim() ?? "";
  const accountType = searchParams.get("account_type") ?? "";
  const owner = searchParams.get("owner_user_id");
  const city = searchParams.get("city")?.trim() ?? "";
  const { page, limit, offset } = parsePagination(searchParams);

  const where = createWhere(["a.deleted_at IS NULL"]);
  if (scope?.companyId) where.add("a.company_id = ?", scope.companyId);
  if (scope?.businessScope === "branch" && scope.branchId) where.add("a.branch_id = ?", scope.branchId);
  // Role sales: account miliknya, tanpa owner, atau punya lead miliknya
  if (user.role === "sales") {
    const me = where.param(user.id);
    where.push(`(a.owner_user_id = ${me} OR a.owner_user_id IS NULL
      OR EXISTS (SELECT 1 FROM crm.crm_sales_leads l
                  WHERE l.account_id = a.id AND l.deleted_at IS NULL AND l.owner_user_id = ${me}))`);
  }
  if ((ACCOUNT_TYPES as readonly string[]).includes(accountType)) where.add("a.account_type = ?", accountType);
  if (isUuid(owner)) where.add("a.owner_user_id = ?", owner);
  if (city) where.add("a.city ILIKE ?", `%${city}%`);
  if (q) {
    const like = where.param(`%${q}%`);
    where.push(`(a.name ILIKE ${like} OR a.city ILIKE ${like} OR a.phone ILIKE ${like} OR a.email ILIKE ${like}
      OR EXISTS (SELECT 1 FROM crm.crm_contacts c WHERE c.account_id = a.id AND c.deleted_at IS NULL
                  AND (c.name ILIKE ${like} OR c.phone ILIKE ${like})))`);
  }
  const limitParam = where.param(limit);
  const offsetParam = where.param(offset);
  const rows = await query<{ total_count: string }>(
    `SELECT ${ACCOUNT_COLUMNS}, COUNT(*) OVER() AS total_count
     FROM crm.crm_accounts a
     LEFT JOIN configuration.users u ON u.id = a.owner_user_id
     WHERE ${where.sql()}
     ORDER BY a.updated_at DESC
     LIMIT ${limitParam} OFFSET ${offsetParam}`,
    where.params
  );
  const { data, total } = splitTotalCount(rows);
  return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

export async function createAccount(
  user: SalesFunnelUser,
  venue: { companyId: string; branchId: string },
  body: z.infer<typeof accountSchema>
) {
  const phone = body.phone ? requireValidPhone(body.phone, "Nomor telepon tidak valid") : null;
  await assertOwnerAssignable(user, body.owner_user_id, venue.companyId);
  const custom = await resolveCustomValues("account", venue.companyId, body.custom);
  const duplicate = await queryOne<{ id: string }>(
    `SELECT id FROM crm.crm_accounts
     WHERE company_id = $1 AND lower(name) = lower($2) AND deleted_at IS NULL`,
    [venue.companyId, body.name]
  );
  if (duplicate) {
    throw new ApiError(409, "Account dengan nama ini sudah ada", { account_id: duplicate.id });
  }
  return queryOne(
    `INSERT INTO crm.crm_accounts
       (company_id, branch_id, name, account_type, industry, address, city, phone,
        email, website, npwp, notes, owner_user_id, custom, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15)
     RETURNING id, name, account_type, city, owner_user_id, created_at`,
    [
      venue.companyId,
      venue.branchId,
      body.name,
      body.account_type,
      body.industry || null,
      body.address || null,
      body.city || null,
      phone,
      body.email || null,
      body.website || null,
      body.npwp || null,
      body.notes || null,
      body.owner_user_id || (user.role === "sales" ? user.id : null),
      JSON.stringify(custom),
      user.id,
    ]
  );
}

/** Account 360° (EPIC-050 T-1.3): profil + contacts + leads + deals + quotation/invoice ringkas + tasks. */
export async function getAccountDetail(id: string) {
  const [account, contacts, leads, deals, quotations, invoices, tasks] = await Promise.all([
    queryOne(
      `SELECT a.id, a.company_id, a.branch_id, a.name, a.account_type, a.industry,
              a.address, a.city, a.phone, a.email, a.website, a.npwp, a.notes,
              a.owner_user_id, a.custom, a.created_at, a.updated_at,
              u.full_name AS owner_name, b.name AS branch_name
       FROM crm.crm_accounts a
       LEFT JOIN configuration.users u ON u.id = a.owner_user_id
       LEFT JOIN configuration.branches b ON b.id = a.branch_id
       WHERE a.id = $1`,
      [id]
    ),
    query(
      `SELECT c.id, c.name, c.title, c.phone, c.email, c.is_primary, c.customer_id,
              c.owner_user_id, c.created_at, u.full_name AS owner_name
       FROM crm.crm_contacts c
       LEFT JOIN configuration.users u ON u.id = c.owner_user_id
       WHERE c.account_id = $1 AND c.deleted_at IS NULL
       ORDER BY c.is_primary DESC, c.created_at ASC
       LIMIT 200`,
      [id]
    ),
    query(
      `SELECT l.id, l.org_name, l.pic_name, l.pic_phone, l.source, l.temperature,
              l.status, l.owner_user_id, l.created_at, u.full_name AS owner_name
       FROM crm.crm_sales_leads l
       LEFT JOIN configuration.users u ON u.id = l.owner_user_id
       WHERE l.account_id = $1 AND l.deleted_at IS NULL
       ORDER BY l.created_at DESC
       LIMIT 100`,
      [id]
    ),
    query(
      `SELECT d.id, d.lead_id, d.title, d.event_type, d.event_date, d.pax_estimate,
              d.value_estimate, d.value_final, d.closed_at, d.entered_stage_at, d.created_at,
              s.name AS stage_name, s.code AS stage_code, s.is_won, s.is_lost,
              lr.name AS lost_reason_name
       FROM crm.crm_sales_deals d
       JOIN crm.crm_sales_leads l ON l.id = d.lead_id
       JOIN crm.crm_sales_stages s ON s.id = d.stage_id
       LEFT JOIN crm.crm_sales_lost_reasons lr ON lr.id = d.lost_reason_id
       WHERE l.account_id = $1 AND d.deleted_at IS NULL
       ORDER BY d.created_at DESC
       LIMIT 100`,
      [id]
    ),
    query(
      `SELECT q.id, q.deal_id, q.quote_number, q.status, q.total, q.valid_until, q.created_at
       FROM crm.crm_sales_quotations q
       JOIN crm.crm_sales_deals d ON d.id = q.deal_id
       JOIN crm.crm_sales_leads l ON l.id = d.lead_id
       WHERE l.account_id = $1 AND q.deleted_at IS NULL
       ORDER BY q.created_at DESC
       LIMIT 50`,
      [id]
    ),
    query(
      `SELECT i.id, i.deal_id, i.invoice_number, i.label, i.amount, i.due_date, i.status, i.created_at
       FROM crm.crm_sales_invoices i
       JOIN crm.crm_sales_deals d ON d.id = i.deal_id
       JOIN crm.crm_sales_leads l ON l.id = d.lead_id
       WHERE l.account_id = $1 AND i.deleted_at IS NULL
       ORDER BY i.created_at DESC
       LIMIT 50`,
      [id]
    ),
    query(
      `SELECT a.id, a.activity_type, a.title, a.notes, a.due_at, a.done_at, a.status,
              a.priority, a.subject_type, a.subject_id, a.created_at, u.full_name AS owner_name
       FROM crm.crm_sales_activities a
       LEFT JOIN configuration.users u ON u.id = a.owner_user_id
       WHERE a.deleted_at IS NULL
         AND ((a.subject_type = 'account' AND a.subject_id = $1)
              OR a.lead_id IN (SELECT id FROM crm.crm_sales_leads WHERE account_id = $1 AND deleted_at IS NULL)
              OR a.deal_id IN (SELECT d.id FROM crm.crm_sales_deals d JOIN crm.crm_sales_leads l ON l.id = d.lead_id
                               WHERE l.account_id = $1 AND d.deleted_at IS NULL)
              OR (a.subject_type = 'contact' AND a.subject_id IN
                    (SELECT id FROM crm.crm_contacts WHERE account_id = $1 AND deleted_at IS NULL)))
       ORDER BY COALESCE(a.due_at, a.created_at) DESC
       LIMIT 50`,
      [id]
    ),
  ]);
  return { account, contacts, leads, deals, quotations, invoices, tasks };
}

export async function updateAccount(
  user: SalesFunnelUser,
  account: { id: string; company_id: string },
  body: z.infer<typeof updateAccountSchema>
) {
  await assertOwnerAssignable(user, body.owner_user_id, account.company_id);
  if (body.name) {
    const duplicate = await queryOne<{ id: string }>(
      `SELECT id FROM crm.crm_accounts
       WHERE company_id = $1 AND lower(name) = lower($2) AND deleted_at IS NULL AND id <> $3`,
      [account.company_id, body.name, account.id]
    );
    if (duplicate) throw ApiError.conflict("Account dengan nama ini sudah ada");
  }
  const { phone, custom, ...fields } = body;
  const update = createUpdateSet();
  update.setAll(fields, true);
  if (phone !== undefined) {
    update.set("phone", phone ? requireValidPhone(phone, "Nomor telepon tidak valid") : null);
  }
  if (custom !== undefined) {
    const existing = await loadExistingCustom("crm.crm_accounts", account.id);
    update.set("custom", JSON.stringify(await resolveCustomValues("account", account.company_id, custom, existing)), "::jsonb");
  }
  const { sql, values, idParam } = update.build(account.id);
  return queryOne(
    `UPDATE crm.crm_accounts SET ${sql} WHERE id = ${idParam}
     RETURNING id, name, account_type, city, owner_user_id, updated_at`,
    values
  );
}

export async function deleteAccount(id: string): Promise<void> {
  const inUse = await queryOne<{ n: string }>(
    `SELECT count(*) AS n FROM crm.crm_sales_leads WHERE account_id = $1 AND deleted_at IS NULL`,
    [id]
  );
  if (Number(inUse?.n ?? 0) > 0) {
    throw ApiError.conflict("Account masih punya lead aktif — hapus/pindahkan lead-nya dulu");
  }
  await query(`UPDATE crm.crm_contacts SET account_id = NULL, updated_at = now() WHERE account_id = $1`, [id]);
  await query(`UPDATE crm.crm_accounts SET deleted_at = now(), updated_at = now() WHERE id = $1`, [id]);
}
