import "server-only";
/**
 * EPIC-050 T-5.3 — sisi server form publik.
 * Tidak ada sesi login di sini: tenant diambil dari form (slug = kredensial),
 * seluruh isian divalidasi ulang, dan kiriman selalu dicatat untuk audit.
 */
import { createHash } from "node:crypto";
import { ApiError } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { createPgClient } from "@/lib/pg/create-client";
import { getCrmDefaultVenue } from "@/lib/crm/server";
import { emitCrmEvent } from "@/lib/crm/events";
import { notifyUsers } from "@/lib/crm/workflow-engine";
import { loadGatewayConfig, sendGatewayText } from "@/lib/whatsapp/gateway";
import { isValidNormalizedPhone, normalizePhone } from "@/lib/sales-funnel/server";
import {
  DEFAULT_FORM_FIELDS,
  buildLeadAlert,
  isLikelyBot,
  leadOrgName,
  parseAttribution,
  publicFieldSchema,
  sourceFromAttribution,
  validateSubmission,
  type Attribution,
  type PublicFieldDef,
  type SubmissionResult,
} from "./public-forms";

export interface PublicFormRow {
  id: string;
  company_id: string | null;
  branch_id: string | null;
  slug: string;
  name: string;
  title: string;
  description: string | null;
  fields: unknown;
  submit_label: string;
  success_message: string;
  redirect_url: string | null;
  default_source: string;
  notify_user_ids: unknown;
  notify_numbers: unknown;
  is_active: boolean;
}

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,49}$/;

/** Ambil form aktif berdasar slug. Slug tidak valid ditolak sebelum menyentuh DB. */
export async function loadPublicForm(slug: string): Promise<PublicFormRow | null> {
  if (!SLUG_PATTERN.test(slug)) return null;
  return queryOne<PublicFormRow>(
    `SELECT id, company_id, branch_id, slug, name, title, description, fields, submit_label,
            success_message, redirect_url, default_source, notify_user_ids, notify_numbers, is_active
     FROM crm.crm_forms
     WHERE slug = $1 AND is_active AND deleted_at IS NULL`,
    [slug]
  );
}

/** Definisi field tersimpan; kosong/rusak → field bawaan supaya form tetap tampil. */
export function formFields(raw: unknown): PublicFieldDef[] {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_FORM_FIELDS;
  const parsed = raw.map((f) => publicFieldSchema.safeParse(f)).filter((r) => r.success);
  return parsed.length > 0 ? parsed.map((r) => r.data) : DEFAULT_FORM_FIELDS;
}

export interface PublicFormViewData {
  slug: string;
  title: string;
  description: string | null;
  fields: PublicFieldDef[];
  submit_label: string;
  success_message: string;
  redirect_url: string | null;
  rendered_at: number;
}

/**
 * Bentuk data untuk komponen halaman publik. Stempel waktu dibuat di sini,
 * bukan di badan komponen, supaya render tetap murni.
 */
export function publicFormView(form: PublicFormRow): PublicFormViewData {
  return {
    slug: form.slug,
    title: form.title,
    description: form.description,
    fields: formFields(form.fields),
    submit_label: form.submit_label,
    success_message: form.success_message,
    redirect_url: form.redirect_url,
    rendered_at: Date.now(),
  };
}

function idList(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
}

/** IP disimpan sebagai hash — cukup untuk menelusuri spam tanpa menyimpan IP mentah. */
function hashIp(ip: string): string {
  return createHash("sha256").update(`bcdcoffee-form:${ip}`).digest("hex").slice(0, 64);
}

async function recordSubmission(input: {
  formId: string;
  leadId: string | null;
  payload: unknown;
  utm: Attribution;
  ipHash: string;
  userAgent: string | null;
  status: "ok" | "rejected" | "duplicate";
  reason?: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO crm.crm_form_submissions (form_id, lead_id, payload, utm, ip_hash, user_agent, status, reason)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8)`,
    [
      input.formId,
      input.leadId,
      JSON.stringify(input.payload ?? {}),
      JSON.stringify(input.utm),
      input.ipHash,
      input.userAgent?.slice(0, 300) ?? null,
      input.status,
      input.reason?.slice(0, 200) ?? null,
    ]
  );
}

interface CreateLeadResult {
  leadId: string;
  duplicate: boolean;
}

/**
 * Buat lead dari kiriman form. Bila kombinasi (company, nomor, instansi) sudah
 * ada, lead lama dipakai kembali dan kiriman dicatat sebagai catatan tambahan —
 * lebih berguna daripada menolak kiriman pelanggan.
 */
async function createLeadFromSubmission(
  form: PublicFormRow,
  submission: SubmissionResult,
  attribution: Attribution
): Promise<CreateLeadResult | null> {
  let companyId = form.company_id;
  let branchId = form.branch_id;
  if (!companyId) {
    const venue = await getCrmDefaultVenue(createPgClient());
    companyId = venue.companyId;
    branchId = branchId ?? venue.branchId;
  }
  if (!companyId) return null;

  const orgName = leadOrgName(submission.lead);
  const phone = submission.lead.pic_phone ? normalizePhone(submission.lead.pic_phone) : null;
  const source = sourceFromAttribution(attribution, form.default_source);

  const existing = phone
    ? await queryOne<{ id: string }>(
        `SELECT id FROM crm.crm_sales_leads
         WHERE company_id = $1 AND pic_phone = $2 AND lower(org_name) = lower($3) AND deleted_at IS NULL
         LIMIT 1`,
        [companyId, phone, orgName]
      )
    : null;

  if (existing) {
    const note = submission.lead.notes?.trim();
    if (note) {
      await query(
        `UPDATE crm.crm_sales_leads
         SET notes = COALESCE(notes || E'\\n\\n', '') || $2, updated_at = now()
         WHERE id = $1`,
        [existing.id, `[Form publik ${formatDate(new Date())}] ${note}`.slice(0, 4000)]
      );
    }
    return { leadId: existing.id, duplicate: true };
  }

  const inserted = await queryOne<{ id: string }>(
    `INSERT INTO crm.crm_sales_leads
       (company_id, branch_id, org_name, org_type, pic_name, pic_phone, pic_email, city, notes,
        source, temperature, status, custom,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term, landing_page, referrer)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'hangat', 'baru', $11::jsonb,
             $12, $13, $14, $15, $16, $17, $18)
     RETURNING id`,
    [
      companyId,
      branchId,
      orgName,
      submission.lead.org_type ?? "lainnya",
      submission.lead.pic_name ?? null,
      phone,
      submission.lead.pic_email ?? null,
      submission.lead.city ?? null,
      submission.lead.notes ?? null,
      source,
      JSON.stringify(submission.custom),
      attribution.utm_source,
      attribution.utm_medium,
      attribution.utm_campaign,
      attribution.utm_content,
      attribution.utm_term,
      attribution.landing_page,
      attribution.referrer,
    ]
  );
  if (!inserted) return null;

  // Skor & workflow otomatis ikut jalan seperti lead yang dibuat dari dashboard.
  await emitCrmEvent({
    company_id: companyId,
    branch_id: branchId,
    event_type: "lead.created",
    subject_type: "lead",
    subject_id: inserted.id,
    payload: { source: "public_form", form_slug: form.slug, utm: attribution },
    actor_user_id: null,
  });
  return { leadId: inserted.id, duplicate: false };
}

/** Beri tahu sales lewat notifikasi aplikasi dan WhatsApp. */
async function notifyNewLead(
  form: PublicFormRow,
  leadId: string,
  submission: SubmissionResult,
  attribution: Attribution
): Promise<void> {
  const userIds = idList(form.notify_user_ids);
  const link = `/dashboard/sales-funnel/leads/${leadId}`;
  if (userIds.length > 0) {
    await notifyUsers(
      userIds,
      `Lead baru: ${leadOrgName(submission.lead)}`,
      `Dari form publik ${form.name}${submission.lead.pic_phone ? ` · ${submission.lead.pic_phone}` : ""}`,
      link,
      { form_id: form.id, lead_id: leadId }
    ).catch(() => 0);
  }

  const message = buildLeadAlert(form.name, submission.lead, attribution);
  const numbers = new Set<string>();
  for (const raw of idList(form.notify_numbers)) {
    const p = normalizePhone(raw);
    if (isValidNormalizedPhone(p)) numbers.add(p);
  }
  for (const uid of userIds) {
    const emp = await queryOne<{ phone: string | null }>(
      `SELECT phone FROM hris.employees WHERE user_id = $1 AND phone IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
      [uid]
    ).catch(() => null);
    const p = emp?.phone ? normalizePhone(emp.phone) : "";
    if (isValidNormalizedPhone(p)) numbers.add(p);
  }
  if (numbers.size === 0) return;
  const config = await loadGatewayConfig();
  if (!config) return;
  for (const target of numbers) {
    await sendGatewayText(config, { target, message }).catch((e) => console.error("[public-form] WA gagal:", e));
  }
}

async function bumpSubmissionCount(formId: string): Promise<void> {
  await query(`UPDATE crm.crm_forms SET submission_count = submission_count + 1, updated_at = now() WHERE id = $1`, [formId]);
}

/**
 * Kiriman form publik → lead + scoring + workflow + notifikasi sales. Setiap
 * kiriman dicatat (termasuk yang ditolak). Bot dibalas seolah berhasil supaya
 * tidak belajar polanya. 400 = isian tidak valid, 503 = venue belum dikonfigurasi.
 */
export async function submitPublicForm(
  form: PublicFormRow,
  payload: Record<string, unknown>,
  client: { ip: string; userAgent: string | null }
): Promise<{ message: string; redirect_url: string | null }> {
  const done = { message: form.success_message, redirect_url: form.redirect_url };
  const attribution = parseAttribution(payload);
  const record = (leadId: string | null, status: "ok" | "rejected" | "duplicate", reason?: string) =>
    recordSubmission({
      formId: form.id, leadId, payload, utm: attribution, ipHash: hashIp(client.ip), userAgent: client.userAgent, status, reason,
    });

  const bot = isLikelyBot(payload);
  if (bot.bot) {
    await record(null, "rejected", bot.reason);
    return done;
  }

  const submission = validateSubmission(formFields(form.fields), payload);
  if (!submission.ok) {
    await record(null, "rejected", "validasi gagal");
    throw ApiError.badRequest("Periksa kembali isian Anda", submission.errors);
  }

  const created = await createLeadFromSubmission(form, submission, attribution);
  if (!created) {
    await record(null, "rejected", "venue belum dikonfigurasi");
    throw new ApiError(503, "Form belum siap menerima kiriman. Hubungi kami lewat WhatsApp.");
  }

  await record(created.leadId, created.duplicate ? "duplicate" : "ok");
  await bumpSubmissionCount(form.id);
  // Notifikasi tidak boleh menggagalkan respons ke pengirim form.
  if (!created.duplicate) await notifyNewLead(form, created.leadId, submission, attribution).catch(() => undefined);
  return done;
}
