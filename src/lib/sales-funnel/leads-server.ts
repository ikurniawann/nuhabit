import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import type { UserScope } from "@/lib/api/scope";
import { loadExistingCustom } from "@/lib/crm/custom-fields-server";
import { emitCrmEvent } from "@/lib/crm/events";
import { query, queryOne } from "@/lib/db";
import { syncLeadAccountContact } from "./account-sync";
import {
  LEAD_ORG_TYPES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  LEAD_TEMPERATURES,
  assertOwnerAssignable,
  isValidNormalizedPhone,
  normalizePhone,
  requireValidPhone,
  resolveCustomValues,
  type SalesFunnelUser,
} from "./server";
import { createUpdateSet, createWhere, isUuid, parsePagination, splitTotalCount } from "./sql";

const LEAD_COLUMNS = `
  l.id, l.company_id, l.branch_id, l.org_name, l.org_type, l.pic_name,
  l.pic_title, l.pic_phone, l.pic_email, l.city, l.source, l.temperature,
  l.status, l.notes, l.owner_user_id, l.customer_id, l.created_at,
  l.updated_at, l.score, l.account_id, l.contact_id, u.full_name AS owner_name`;

const DUPLICATE_LEAD = "Lead instansi ini dengan PIC yang sama sudah ada";
const INVALID_PIC_PHONE = "No. WA PIC tidak valid";

export const createLeadSchema = z.object({
  org_name: z.string().trim().min(1).max(200),
  org_type: z.enum(LEAD_ORG_TYPES).default("corporate"),
  pic_name: z.string().trim().min(1).max(150),
  pic_title: z.string().trim().max(100).optional().nullable(),
  pic_phone: z.string().trim().min(8).max(30),
  pic_email: z.string().trim().email().max(150).optional().nullable().or(z.literal("")),
  city: z.string().trim().max(100).optional().nullable(),
  source: z.enum(LEAD_SOURCES).default("lainnya"),
  temperature: z.enum(LEAD_TEMPERATURES).default("hangat"),
  status: z.enum(LEAD_STATUSES).default("baru"),
  notes: z.string().trim().max(2000).optional().nullable(),
  owner_user_id: z.string().uuid().optional().nullable(),
  // EPIC-050 Fase 3
  custom: z.record(z.string(), z.unknown()).optional(),
});

export const updateLeadSchema = z.object({
  custom: z.record(z.string(), z.unknown()).optional(),
  org_name: z.string().trim().min(1).max(200).optional(),
  org_type: z.enum(LEAD_ORG_TYPES).optional(),
  pic_name: z.string().trim().min(1).max(150).optional(),
  pic_title: z.string().trim().max(100).nullable().optional(),
  pic_phone: z.string().trim().min(8).max(30).optional(),
  pic_email: z.string().trim().email().max(150).nullable().optional().or(z.literal("")),
  city: z.string().trim().max(100).nullable().optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  temperature: z.enum(LEAD_TEMPERATURES).optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  owner_user_id: z.string().uuid().nullable().optional(),
});

export const linkCustomerSchema = z
  .object({
    // Tautkan member existing…
    customer_id: z.string().uuid().optional().nullable(),
    // …atau buat member baru dari data PIC (alur "Menang → jadikan member")
    create_from_pic: z.boolean().default(false),
  })
  .refine((v) => v.customer_id || v.create_from_pic, {
    message: "Pilih member atau buat dari PIC",
  });

/** Race dua request lolos cek duplikat → unique index; petakan ke 409 yang sama. */
function rethrowDuplicate(error: unknown): never {
  if ((error as { code?: string } | null)?.code === "23505") throw ApiError.conflict(DUPLICATE_LEAD);
  throw error;
}

/** Perubahan field untuk kondisi workflow changed/changed_to. */
export function diffLeadChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, value] of Object.entries(after)) {
    if (value === undefined) continue;
    if (!(key in before)) changes[key] = { from: undefined, to: value };
    else if (before[key] !== value) changes[key] = { from: before[key], to: value };
  }
  return changes;
}

export async function listLeads(user: SalesFunnelUser, scope: UserScope | null, searchParams: URLSearchParams) {
  const q = searchParams.get("q")?.trim() ?? "";
  const filters: Array<[string, string, readonly string[]]> = [
    ["l.status", searchParams.get("status") ?? "", LEAD_STATUSES],
    ["l.org_type", searchParams.get("org_type") ?? "", LEAD_ORG_TYPES],
    ["l.source", searchParams.get("source") ?? "", LEAD_SOURCES],
    ["l.temperature", searchParams.get("temperature") ?? "", LEAD_TEMPERATURES],
  ];
  const owner = searchParams.get("owner_user_id");
  // EPIC-050 Fase 2: urut skor (lead panas dulu) atau terbaru
  const sort = searchParams.get("sort") === "score" ? "l.score DESC, l.created_at DESC" : "l.created_at DESC";
  const { page, limit, offset } = parsePagination(searchParams);

  const where = createWhere(["l.deleted_at IS NULL"]);
  // Scope bisnis: holding/super tanpa scope melihat semua; company/branch dibatasi ke venuenya
  if (scope?.companyId) where.add("l.company_id = ?", scope.companyId);
  if (scope?.businessScope === "branch" && scope.branchId) where.add("l.branch_id = ?", scope.branchId);
  // Role sales hanya melihat lead miliknya ATAU tanpa owner (unassigned)
  if (user.role === "sales") where.add("(l.owner_user_id = ? OR l.owner_user_id IS NULL)", user.id);
  for (const [column, value, allowed] of filters) {
    if (allowed.includes(value)) where.add(`${column} = ?`, value);
  }
  if (isUuid(owner)) where.add("l.owner_user_id = ?", owner);
  if (q) {
    const like = where.param(`%${q}%`);
    where.push(`(l.org_name ILIKE ${like} OR l.pic_name ILIKE ${like} OR l.pic_phone ILIKE ${like})`);
  }
  const limitParam = where.param(limit);
  const offsetParam = where.param(offset);
  const rows = await query<{ total_count: string }>(
    `SELECT ${LEAD_COLUMNS}, COUNT(*) OVER() AS total_count
     FROM crm.crm_sales_leads l
     LEFT JOIN configuration.users u ON u.id = l.owner_user_id
     WHERE ${where.sql()}
     ORDER BY ${sort}
     LIMIT ${limitParam} OFFSET ${offsetParam}`,
    where.params
  );
  const { data, total } = splitTotalCount(rows);
  return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

export async function createLead(
  user: SalesFunnelUser,
  venue: { companyId: string; branchId: string },
  body: z.infer<typeof createLeadSchema>
) {
  const phone = requireValidPhone(body.pic_phone, INVALID_PIC_PHONE);
  await assertOwnerAssignable(user, body.owner_user_id, venue.companyId);

  // Satu PIC boleh membawa banyak leads — duplikat hanya bila kombinasi
  // instansi + no. WA sama persis (masukan owner 2026-07-22)
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM crm.crm_sales_leads
     WHERE company_id = $1 AND pic_phone = $2
       AND lower(org_name) = lower($3) AND deleted_at IS NULL`,
    [venue.companyId, phone, body.org_name]
  );
  if (existing) throw ApiError.conflict(DUPLICATE_LEAD);

  const custom = await resolveCustomValues("lead", venue.companyId, body.custom);
  const row = await queryOne<{ id: string }>(
    `INSERT INTO crm.crm_sales_leads
       (company_id, branch_id, org_name, org_type, pic_name, pic_title,
        pic_phone, pic_email, city, source, temperature, status, notes,
        owner_user_id, created_by, custom)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb)
     RETURNING id, org_name, pic_name, pic_phone, status`,
    [
      venue.companyId,
      venue.branchId,
      body.org_name,
      body.org_type,
      body.pic_name,
      body.pic_title || null,
      phone,
      body.pic_email || null,
      body.city || null,
      body.source,
      body.temperature,
      body.status,
      body.notes || null,
      body.owner_user_id || (user.role === "sales" ? user.id : null),
      user.id,
      JSON.stringify(custom),
    ]
  ).catch(rethrowDuplicate);

  if (row?.id) {
    // EPIC-050: tautkan ke Account/Contact (upsert by nama/nomor WA)
    await syncLeadAccountContact(row.id).catch((e) => console.error("[sales-funnel] sync account/contact gagal:", e));
    // EPIC-050 Fase 2: event bus → scoring + workflow
    await emitCrmEvent({
      event_type: "lead.created",
      subject_type: "lead",
      subject_id: row.id,
      company_id: venue.companyId,
      branch_id: venue.branchId,
      actor_user_id: user.id,
      payload: { source: body.source, org_type: body.org_type, temperature: body.temperature },
    });
  }
  return row;
}

/**
 * Detail 360° instansi (EPIC-022 Fase D): lead + semua deal/acara + aktivitas
 * gabungan (lead & deal-dealnya) + ringkasan member loyalty PIC bila tertaut.
 */
export async function getLeadDetail(id: string) {
  const lead = await queryOne<{ customer_id: string | null }>(
    `SELECT l.id, l.company_id, l.branch_id, l.org_name, l.org_type,
            l.pic_name, l.pic_title, l.pic_phone, l.pic_email, l.city,
            l.source, l.temperature, l.status, l.notes, l.owner_user_id,
            l.customer_id, l.account_id, l.contact_id, l.score, l.score_breakdown, l.score_updated_at, l.custom, l.created_at, l.updated_at,
            l.utm_source, l.utm_medium, l.utm_campaign, l.utm_content, l.utm_term, l.landing_page, l.referrer,
            u.full_name AS owner_name, b.name AS branch_name, acc.name AS account_name
     FROM crm.crm_sales_leads l
     LEFT JOIN configuration.users u ON u.id = l.owner_user_id
     LEFT JOIN configuration.branches b ON b.id = l.branch_id
     LEFT JOIN crm.crm_accounts acc ON acc.id = l.account_id
     WHERE l.id = $1`,
    [id]
  );
  const deals = await query(
    `SELECT d.id, d.title, d.event_type, d.event_date, d.is_event_date_fixed,
            d.pax_estimate, d.value_estimate, d.value_final, d.closed_at,
            d.entered_stage_at, d.created_at,
            s.name AS stage_name, s.code AS stage_code, s.is_won, s.is_lost,
            lr.name AS lost_reason_name
     FROM crm.crm_sales_deals d
     JOIN crm.crm_sales_stages s ON s.id = d.stage_id
     LEFT JOIN crm.crm_sales_lost_reasons lr ON lr.id = d.lost_reason_id
     WHERE d.lead_id = $1 AND d.deleted_at IS NULL
     ORDER BY d.created_at DESC
     -- pagar wajar; statistik 360° ikut terpotong bila riwayat > 100 deal
     LIMIT 100`,
    [id]
  );
  // Timeline gabungan: aktivitas lead + aktivitas semua deal-nya
  const activities = await query(
    `SELECT a.id, a.deal_id, a.activity_type, a.notes, a.due_at, a.done_at,
            a.created_at, u.full_name AS owner_name, d.title AS deal_title
     FROM crm.crm_sales_activities a
     LEFT JOIN configuration.users u ON u.id = a.owner_user_id
     LEFT JOIN crm.crm_sales_deals d ON d.id = a.deal_id
     WHERE a.deleted_at IS NULL
       AND (a.lead_id = $1
            OR a.deal_id IN (SELECT id FROM crm.crm_sales_deals
                             WHERE lead_id = $1 AND deleted_at IS NULL))
     ORDER BY COALESCE(a.due_at, a.created_at) DESC
     LIMIT 30`,
    [id]
  );

  // Ringkasan member loyalty (pos_customers global by design EPIC-011)
  const customer = lead?.customer_id
    ? await queryOne(
        `SELECT id, name, phone, membership_tier, total_xp, ark_coin_balance,
                total_spent, visit_count, last_visit, is_active
         FROM pos.pos_customers WHERE id = $1`,
        [lead.customer_id]
      )
    : null;
  const recentOrders = customer
    ? await query(
        `SELECT id, total_amount, status, payment_status, created_at
         FROM pos.pos_orders
         WHERE customer_id = $1
         ORDER BY created_at DESC
         LIMIT 5`,
        [lead?.customer_id]
      )
    : [];
  return { lead, deals, activities, customer, recent_orders: recentOrders };
}

export async function updateLead(
  user: SalesFunnelUser,
  lead: { id: string; company_id: string; branch_id: string },
  input: z.infer<typeof updateLeadSchema>
) {
  const { custom, ...body } = input;
  // EPIC-050 Fase 2: snapshot sebelum update utk kondisi workflow changed/changed_to
  const before =
    (await queryOne<Record<string, unknown> & { org_name: string; pic_phone: string }>(
      `SELECT org_name, org_type, pic_name, pic_phone, pic_email, city, source, temperature,
              status, notes, owner_user_id FROM crm.crm_sales_leads WHERE id = $1`,
      [lead.id]
    )) ?? null;
  if (body.pic_phone !== undefined) body.pic_phone = requireValidPhone(body.pic_phone, INVALID_PIC_PHONE);
  // Duplikat = kombinasi instansi + no. WA sama (satu PIC boleh banyak leads);
  // cek saat salah satunya berubah, pakai nilai efektif
  if (body.pic_phone !== undefined || body.org_name !== undefined) {
    const duplicate = await queryOne<{ id: string }>(
      `SELECT id FROM crm.crm_sales_leads
       WHERE company_id = $1 AND pic_phone = $2
         AND lower(org_name) = lower($3) AND id <> $4 AND deleted_at IS NULL`,
      [lead.company_id, body.pic_phone ?? before?.pic_phone ?? "", body.org_name ?? before?.org_name ?? "", lead.id]
    );
    if (duplicate) throw ApiError.conflict(DUPLICATE_LEAD);
  }
  if (body.pic_email === "") body.pic_email = null;
  await assertOwnerAssignable(user, body.owner_user_id, lead.company_id);

  const update = createUpdateSet();
  if (custom !== undefined) {
    const existing = await loadExistingCustom("crm.crm_sales_leads", lead.id);
    update.set("custom", JSON.stringify(await resolveCustomValues("lead", lead.company_id, custom, existing)), "::jsonb");
  }
  update.setAll(body);
  const { sql, values, idParam } = update.build(lead.id);
  const row = await queryOne(
    `UPDATE crm.crm_sales_leads SET ${sql}
     WHERE id = ${idParam}
     RETURNING id, org_name, pic_name, pic_phone, status`,
    values
  ).catch(rethrowDuplicate);

  // EPIC-050: nama instansi / PIC berubah → sinkronkan Account/Contact
  await syncLeadAccountContact(lead.id).catch((e) => console.error("[sales-funnel] sync account/contact gagal:", e));
  const changes = diffLeadChanges(before ?? {}, body);
  await emitCrmEvent({
    event_type: "lead.updated",
    subject_type: "lead",
    subject_id: lead.id,
    company_id: lead.company_id,
    branch_id: lead.branch_id,
    actor_user_id: user.id,
    payload: { changed_fields: Object.keys(changes) },
    changes,
  });
  return row;
}

export async function softDeleteLead(id: string): Promise<void> {
  await queryOne(`UPDATE crm.crm_sales_leads SET deleted_at = now(), updated_at = now() WHERE id = $1 RETURNING id`, [id]);
}

/**
 * Lookup PIC by no. WA: satu PIC bisa membawa banyak leads — prefill data PIC
 * dan daftar instansi yang ia bawa. Visibilitas mengikuti aturan list leads.
 */
export async function lookupPicByPhone(user: SalesFunnelUser, scope: UserScope | null, rawPhone: string) {
  const phone = normalizePhone(rawPhone);
  if (!isValidNormalizedPhone(phone)) return null;

  const where = createWhere(["l.deleted_at IS NULL"]);
  where.add("l.pic_phone = ?", phone);
  if (scope?.companyId) where.add("l.company_id = ?", scope.companyId);
  if (scope?.businessScope === "branch" && scope.branchId) where.add("l.branch_id = ?", scope.branchId);
  if (user.role === "sales") where.add("(l.owner_user_id = ? OR l.owner_user_id IS NULL)", user.id);

  const rows = await query<{
    id: string;
    org_name: string;
    status: string;
    pic_name: string;
    pic_title: string | null;
    pic_email: string | null;
  }>(
    `SELECT l.id, l.org_name, l.status, l.pic_name, l.pic_title, l.pic_email
     FROM crm.crm_sales_leads l
     WHERE ${where.sql()}
     ORDER BY l.updated_at DESC
     LIMIT 10`,
    where.params
  );
  if (rows.length === 0) return null;
  return {
    pic: { name: rows[0].pic_name, title: rows[0].pic_title, email: rows[0].pic_email },
    leads: rows.map((row) => ({ id: row.id, org_name: row.org_name, status: row.status })),
  };
}

/**
 * Fase D: tautkan PIC lead ke member loyalty (pos_customers global by design).
 * `create_from_pic` membuat/memakai pos_customers dengan nomor PIC lalu
 * meng-enrol profil loyalty tier regular.
 */
export async function linkLeadCustomer(leadId: string, input: z.infer<typeof linkCustomerSchema>): Promise<string> {
  const lead = await queryOne<{
    org_name: string;
    pic_name: string;
    pic_phone: string;
    pic_email: string | null;
    city: string | null;
  }>(`SELECT org_name, pic_name, pic_phone, pic_email, city FROM crm.crm_sales_leads WHERE id = $1`, [leadId]);
  if (!lead) throw ApiError.notFound("Lead tidak ditemukan");

  const customerId = input.customer_id
    ? await requirePicCustomer(input.customer_id, lead.pic_phone)
    : await upsertCustomerFromPic(lead);
  if (!customerId) throw ApiError.server("Gagal menyiapkan member");

  await queryOne(`UPDATE crm.crm_sales_leads SET customer_id = $1, updated_at = now() WHERE id = $2 RETURNING id`, [
    customerId,
    leadId,
  ]);
  return customerId;
}

/**
 * Anti-IDOR (temuan security gate Fase D): tautan hanya untuk member yang
 * MEMANG PIC-nya — nomor WA harus sama (keduanya kanonik 62…).
 */
async function requirePicCustomer(customerId: string, picPhone: string): Promise<string> {
  const customer = await queryOne<{ id: string; phone: string | null }>(
    `SELECT id, phone FROM pos.pos_customers WHERE id = $1 AND is_active = true`,
    [customerId]
  );
  if (!customer) throw ApiError.notFound("Member tidak ditemukan");
  if (!customer.phone || customer.phone !== picPhone) {
    throw ApiError.badRequest(
      "No. WA member tidak sama dengan no. WA PIC — hanya member milik PIC yang bisa ditautkan"
    );
  }
  return customer.id;
}

/** Upsert by phone (UNIQUE pos_customers_phone_key) + enrol loyalty tier regular. */
async function upsertCustomerFromPic(lead: {
  org_name: string;
  pic_name: string;
  pic_phone: string;
  pic_email: string | null;
  city: string | null;
}): Promise<string | null> {
  const upserted = await queryOne<{ id: string }>(
    `INSERT INTO pos.pos_customers (name, phone, email, city, notes)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (phone) DO UPDATE
       SET is_active = true, updated_at = now()
     RETURNING id`,
    [lead.pic_name, lead.pic_phone, lead.pic_email, lead.city, `PIC ${lead.org_name} — didaftarkan dari Sales Funneling`]
  );
  if (!upserted) return null;
  try {
    await queryOne(
      `INSERT INTO crm.crm_member_profiles
         (customer_id, tier_id, lifetime_xp, loyalty_score, status, last_activity_at)
       SELECT $1, t.id, 0, 0, 'active', now()
       FROM crm.crm_membership_tiers t
       WHERE t.code = 'regular'
       ON CONFLICT (customer_id) DO NOTHING
       RETURNING customer_id`,
      [upserted.id]
    );
  } catch (enrollErr) {
    // Hanya "tabel belum ada" (42P01 — skema CRM loyalty belum di-migrate)
    // yang boleh dilewati; error lain harus terlihat.
    if ((enrollErr as { code?: string }).code !== "42P01") throw enrollErr;
    console.warn(
      "[sales-funnel] enrol loyalty dilewati (skema CRM belum siap):",
      enrollErr instanceof Error ? enrollErr.message : enrollErr
    );
  }
  return upserted.id;
}

export async function unlinkLeadCustomer(leadId: string): Promise<void> {
  await queryOne(`UPDATE crm.crm_sales_leads SET customer_id = NULL, updated_at = now() WHERE id = $1 RETURNING id`, [
    leadId,
  ]);
}
