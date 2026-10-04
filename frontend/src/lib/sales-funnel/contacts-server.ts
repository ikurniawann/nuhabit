import type { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import type { UserScope } from "@/lib/api/scope";
import { loadExistingCustom } from "@/lib/crm/custom-fields-server";
import { query, queryOne } from "@/lib/db";
import { requireAccessibleAccount } from "./access";
import type { contactSchema, updateContactSchema } from "./accounts";
import {
  assertOwnerAssignable,
  requireSalesVenue,
  requireValidPhone,
  resolveCustomValues,
  VENUE_MISSING_SHORT,
  type SalesFunnelUser,
} from "./server";
import { createUpdateSet, createWhere, isUuid, parsePagination, splitTotalCount } from "./sql";

/** EPIC-050 Fase 1 (T-1.3) — Contacts: PIC lintas account. */
const CONTACT_COLUMNS = `
  c.id, c.company_id, c.branch_id, c.account_id, c.name, c.title, c.phone, c.email,
  c.is_primary, c.customer_id, c.notes, c.owner_user_id, c.custom, c.created_at, c.updated_at,
  a.name AS account_name, a.account_type,
  u.full_name AS owner_name,
  (SELECT count(*) FROM crm.crm_sales_leads l WHERE l.contact_id = c.id AND l.deleted_at IS NULL)::int AS lead_count,
  (SELECT max(COALESCE(act.done_at, act.created_at)) FROM crm.crm_sales_activities act
     WHERE act.deleted_at IS NULL AND act.subject_type = 'contact' AND act.subject_id = c.id) AS last_activity_at`;

export async function listContacts(user: SalesFunnelUser, scope: UserScope | null, searchParams: URLSearchParams) {
  const q = searchParams.get("q")?.trim() ?? "";
  const accountId = searchParams.get("account_id");
  const owner = searchParams.get("owner_user_id");
  const { page, limit, offset } = parsePagination(searchParams);

  const where = createWhere(["c.deleted_at IS NULL"]);
  if (scope?.companyId) where.add("c.company_id = ?", scope.companyId);
  if (scope?.businessScope === "branch" && scope.branchId) where.add("c.branch_id = ?", scope.branchId);
  if (user.role === "sales") {
    const me = where.param(user.id);
    where.push(`(c.owner_user_id = ${me} OR c.owner_user_id IS NULL
      OR EXISTS (SELECT 1 FROM crm.crm_sales_leads l
                  WHERE l.contact_id = c.id AND l.deleted_at IS NULL AND l.owner_user_id = ${me}))`);
  }
  if (isUuid(accountId)) where.add("c.account_id = ?", accountId);
  if (isUuid(owner)) where.add("c.owner_user_id = ?", owner);
  if (q) {
    const like = where.param(`%${q}%`);
    where.push(
      `(c.name ILIKE ${like} OR c.phone ILIKE ${like} OR c.email ILIKE ${like} OR c.title ILIKE ${like} OR a.name ILIKE ${like})`
    );
  }
  const limitParam = where.param(limit);
  const offsetParam = where.param(offset);
  const rows = await query<{ total_count: string }>(
    `SELECT ${CONTACT_COLUMNS}, COUNT(*) OVER() AS total_count
     FROM crm.crm_contacts c
     LEFT JOIN crm.crm_accounts a ON a.id = c.account_id
     LEFT JOIN configuration.users u ON u.id = c.owner_user_id
     WHERE ${where.sql()}
     ORDER BY c.updated_at DESC
     LIMIT ${limitParam} OFFSET ${offsetParam}`,
    where.params
  );
  const { data, total } = splitTotalCount(rows);
  return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

export async function createContact(
  user: SalesFunnelUser,
  scope: UserScope | null,
  body: z.infer<typeof contactSchema>
) {
  // Venue: dari account bila ada (sekaligus cek akses), else venue user
  const venue = body.account_id
    ? await requireAccessibleAccount(body.account_id, user).then((a) => ({ companyId: a.company_id, branchId: a.branch_id }))
    : await requireSalesVenue(scope, VENUE_MISSING_SHORT);
  const phone = requireValidPhone(body.phone, "Nomor WA tidak valid");
  await assertOwnerAssignable(user, body.owner_user_id, venue.companyId);
  const custom = await resolveCustomValues("contact", venue.companyId, body.custom);
  const duplicate = await queryOne<{ id: string; name: string }>(
    `SELECT id, name FROM crm.crm_contacts WHERE company_id = $1 AND phone = $2 AND deleted_at IS NULL`,
    [venue.companyId, phone]
  );
  if (duplicate) {
    throw new ApiError(409, `Nomor ini sudah terdaftar atas nama ${duplicate.name}`, { contact_id: duplicate.id });
  }
  if (body.is_primary && body.account_id) {
    await query(
      `UPDATE crm.crm_contacts SET is_primary = false, updated_at = now()
       WHERE account_id = $1 AND deleted_at IS NULL`,
      [body.account_id]
    );
  }
  return queryOne(
    `INSERT INTO crm.crm_contacts
       (company_id, branch_id, account_id, name, title, phone, email, is_primary,
        customer_id, notes, owner_user_id, custom, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
     RETURNING id, account_id, name, phone, is_primary, created_at`,
    [
      venue.companyId,
      venue.branchId,
      body.account_id ?? null,
      body.name,
      body.title || null,
      phone,
      body.email || null,
      body.is_primary,
      body.customer_id ?? null,
      body.notes || null,
      body.owner_user_id || (user.role === "sales" ? user.id : null),
      JSON.stringify(custom),
      user.id,
    ]
  );
}

export async function getContactDetail(id: string) {
  const contact = await queryOne<{ customer_id: string | null }>(
    `SELECT c.id, c.company_id, c.branch_id, c.account_id, c.name, c.title, c.phone,
            c.email, c.is_primary, c.customer_id, c.notes, c.owner_user_id, c.custom,
            c.created_at, c.updated_at,
            a.name AS account_name, a.account_type, u.full_name AS owner_name
     FROM crm.crm_contacts c
     LEFT JOIN crm.crm_accounts a ON a.id = c.account_id
     LEFT JOIN configuration.users u ON u.id = c.owner_user_id
     WHERE c.id = $1`,
    [id]
  );
  const leads = await query(
    `SELECT l.id, l.org_name, l.source, l.temperature, l.status, l.created_at
     FROM crm.crm_sales_leads l WHERE l.contact_id = $1 AND l.deleted_at IS NULL
     ORDER BY l.created_at DESC LIMIT 50`,
    [id]
  );
  const customer = contact?.customer_id
    ? await queryOne(
        `SELECT id, name, phone, membership_tier, total_xp, ark_coin_balance,
                total_spent, visit_count, last_visit, is_active
         FROM pos.pos_customers WHERE id = $1`,
        [contact.customer_id]
      )
    : null;
  return { contact, leads, customer };
}

export async function updateContact(
  user: SalesFunnelUser,
  contact: { id: string; company_id: string },
  body: z.infer<typeof updateContactSchema>
) {
  if (body.account_id) {
    const account = await requireAccessibleAccount(body.account_id, user);
    if (account.company_id !== contact.company_id) {
      throw ApiError.badRequest("Account berada di venue lain");
    }
  }
  await assertOwnerAssignable(user, body.owner_user_id, contact.company_id);

  const { phone: rawPhone, custom, ...fields } = body;
  const update = createUpdateSet();
  update.setAll(fields, true);
  if (rawPhone !== undefined) {
    const phone = requireValidPhone(String(rawPhone), "Nomor WA tidak valid");
    const duplicate = await queryOne<{ id: string }>(
      `SELECT id FROM crm.crm_contacts
       WHERE company_id = $1 AND phone = $2 AND deleted_at IS NULL AND id <> $3`,
      [contact.company_id, phone, contact.id]
    );
    if (duplicate) throw ApiError.conflict("Nomor ini sudah dipakai contact lain");
    update.set("phone", phone);
  }
  if (custom !== undefined) {
    const existing = await loadExistingCustom("crm.crm_contacts", contact.id);
    update.set("custom", JSON.stringify(await resolveCustomValues("contact", contact.company_id, custom, existing)), "::jsonb");
  }
  const { sql, values, idParam } = update.build(contact.id);
  const row = await queryOne<{ id: string; account_id: string | null; is_primary: boolean }>(
    `UPDATE crm.crm_contacts SET ${sql} WHERE id = ${idParam}
     RETURNING id, account_id, name, phone, is_primary, updated_at`,
    values
  );
  // Hanya satu contact utama per account
  if (row?.is_primary && row.account_id) {
    await query(
      `UPDATE crm.crm_contacts SET is_primary = false, updated_at = now()
       WHERE account_id = $1 AND id <> $2 AND deleted_at IS NULL AND is_primary`,
      [row.account_id, contact.id]
    );
  }
  return row;
}

export async function deleteContact(id: string): Promise<void> {
  await query(`UPDATE crm.crm_sales_leads SET contact_id = NULL, updated_at = now() WHERE contact_id = $1`, [id]);
  await query(`UPDATE crm.crm_contacts SET deleted_at = now(), updated_at = now() WHERE id = $1`, [id]);
}
