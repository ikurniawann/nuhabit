import "server-only";
/** EPIC-050 T-5.3 — kelola form publik dari dashboard: daftar, buat, ubah, hapus, kiriman. */
import { ApiError, type ApiUser } from "@/lib/api/auth";
import type { UserScope } from "@/lib/api/scope";
import { query, queryOne } from "@/lib/db";
import { scopedCompanyId } from "./guards";
import { DEFAULT_FORM_FIELDS, type PublicFormInput } from "./public-forms";
import { formFields } from "./public-forms-server";

/** Slug form utama halaman /public — tidak boleh dihapus. */
const MAIN_FORM_SLUG = "kontak";

export async function listForms(scope: UserScope | null) {
  const params: unknown[] = [];
  let where = "f.deleted_at IS NULL";
  if (scope?.companyId) {
    params.push(scope.companyId);
    where += ` AND (f.company_id IS NULL OR f.company_id = $${params.length})`;
  }
  const rows = await query<Record<string, unknown> & { fields: unknown }>(
    `SELECT f.id, f.company_id, f.slug, f.name, f.title, f.description, f.fields, f.submit_label,
            f.success_message, f.redirect_url, f.default_source, f.notify_user_ids, f.notify_numbers,
            f.is_active, f.submission_count, f.created_at, f.updated_at,
            (SELECT COUNT(*) FROM crm.crm_form_submissions s WHERE s.form_id = f.id AND s.status = 'rejected') AS rejected_count,
            (SELECT MAX(s.created_at) FROM crm.crm_form_submissions s WHERE s.form_id = f.id) AS last_submission_at
     FROM crm.crm_forms f
     WHERE ${where}
     ORDER BY f.created_at`,
    params
  );
  // Kembalikan field efektif: form yang belum pernah disunting menyimpan array
  // kosong dan memakai field bawaan saat dirender.
  return rows.map((row) => ({ ...row, fields: formFields(row.fields) }));
}

export async function createForm(user: ApiUser, scope: UserScope | null, b: PublicFormInput) {
  const dup = await queryOne<{ id: string }>(`SELECT id FROM crm.crm_forms WHERE slug = $1`, [b.slug]);
  if (dup) throw ApiError.conflict("Slug sudah dipakai form lain");
  return queryOne(
    `INSERT INTO crm.crm_forms
       (company_id, slug, name, title, description, fields, submit_label, success_message, redirect_url,
        default_source, notify_user_ids, notify_numbers, is_active, created_by)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14)
     RETURNING id, slug, name`,
    [
      scopedCompanyId(user, scope), b.slug, b.name, b.title, b.description ?? null,
      JSON.stringify(b.fields.length > 0 ? b.fields : DEFAULT_FORM_FIELDS),
      b.submit_label, b.success_message, b.redirect_url ?? null, b.default_source,
      JSON.stringify(b.notify_user_ids), JSON.stringify(b.notify_numbers), b.is_active, user.id,
    ]
  );
}

/** Form di scope company user; 404 bila tidak ada. */
export async function requireForm(id: string, scope: UserScope | null): Promise<{ id: string; slug: string }> {
  const params: unknown[] = [id];
  let where = "id = $1 AND deleted_at IS NULL";
  if (scope?.companyId) {
    params.push(scope.companyId);
    where += ` AND (company_id IS NULL OR company_id = $${params.length})`;
  }
  const form = await queryOne<{ id: string; slug: string }>(`SELECT id, slug FROM crm.crm_forms WHERE ${where}`, params);
  if (!form) throw ApiError.notFound("Form tidak ditemukan");
  return form;
}

/** Kiriman terakhir form — untuk memantau spam & konversi. */
export function listFormSubmissions(formId: string) {
  return query(
    `SELECT s.id, s.lead_id, s.status, s.reason, s.utm, s.created_at,
            l.org_name, l.pic_name, l.pic_phone
     FROM crm.crm_form_submissions s
     LEFT JOIN crm.crm_sales_leads l ON l.id = s.lead_id
     WHERE s.form_id = $1
     ORDER BY s.created_at DESC
     LIMIT 50`,
    [formId]
  );
}

const JSON_COLUMNS = new Set(["fields", "notify_user_ids", "notify_numbers"]);
const PATCHABLE = [
  "name", "title", "description", "fields", "submit_label", "success_message", "redirect_url",
  "default_source", "notify_user_ids", "notify_numbers", "is_active",
] as const;

/** Slug tidak boleh diubah: URL publik yang sudah disebar akan mati. */
export function updateForm(id: string, b: Partial<Omit<PublicFormInput, "slug">>) {
  const sets: string[] = ["updated_at = now()"];
  const values: unknown[] = [];
  for (const col of PATCHABLE) {
    const value = b[col];
    if (value === undefined) continue;
    const isJson = JSON_COLUMNS.has(col);
    values.push(isJson ? JSON.stringify(value) : value ?? null);
    sets.push(`${col} = $${values.length}${isJson ? "::jsonb" : ""}`);
  }
  if (values.length === 0) throw ApiError.badRequest("Tidak ada field yang diubah");
  values.push(id);
  return queryOne(
    `UPDATE crm.crm_forms SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING id, slug, name, is_active`,
    values
  );
}

export async function deleteForm(form: { id: string; slug: string }): Promise<void> {
  if (form.slug === MAIN_FORM_SLUG) {
    throw ApiError.conflict("Form utama /public tidak bisa dihapus — nonaktifkan saja");
  }
  await query(`UPDATE crm.crm_forms SET deleted_at = now(), is_active = false WHERE id = $1`, [form.id]);
}
