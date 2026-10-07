/**
 * Data Logbook Department (EPIC-009). Setiap operasi menerima aktor dan
 * menegakkan scope department di server lewat resolveDepartmentScope:
 * non-full-access dikunci ke department sendiri.
 */

import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { createServerPgClient, type PgClient } from "@/lib/pg/create-client";
import {
  canDeleteEntry,
  canEditEntryItems,
  canReviewEntry,
  canSubmitEntry,
  getLogbookActor,
  LOGBOOK_NOTE_MAX_LENGTH,
  normalizeLogbookNote,
  resolveDepartmentScope,
  summarizeLogbookEntries,
  templateItemWeight,
  type LogbookActor,
  type LogbookSummaryEntry,
} from "./logbook";
import { unwrap } from "./workforce-route";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── Skema input ─────────────────────────────────────────────────────────

export const logbookListQuerySchema = z.object({
  resource: z.string().default("entries"),
  department_id: z.string().optional(),
  include_inactive: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  date: z.string().optional(),
  status: z.string().optional(),
  limit: z.coerce.number().optional(),
  page: z.coerce.number().optional(),
});

const templateItemSchema = z.object({
  title: z.string().nullish(),
  description: z.string().nullish(),
  weight: z.unknown().optional(),
  is_required: z.boolean().nullish(),
});

const TEMPLATE_REQUIRED = "department_id dan nama template wajib diisi";
const ENTRY_REQUIRED = "template_id dan entry_date wajib diisi";

export const createTemplateSchema = z.object({
  action: z.literal("create-template"),
  department_id: z.string().nullish(),
  name: z.string({ error: TEMPLATE_REQUIRED }).trim().min(1, TEMPLATE_REQUIRED),
  description: z.string().nullish(),
  frequency: z.string().nullish(),
  is_active: z.boolean().nullish(),
  items: z.array(templateItemSchema).nullish(),
});

export const createEntrySchema = z.object({
  action: z.literal("create-entry"),
  template_id: z.string({ error: ENTRY_REQUIRED }).min(1, ENTRY_REQUIRED),
  entry_date: z
    .string({ error: ENTRY_REQUIRED })
    .min(1, ENTRY_REQUIRED)
    .regex(DATE_RE, "Format entry_date harus YYYY-MM-DD"),
  title: z.string().nullish(),
  notes: z.unknown().optional(),
});

export const updateItemSchema = z.object({
  action: z.literal("update-item"),
  item_id: z.string({ error: "item_id is required" }).min(1, "item_id is required"),
  is_checked: z.unknown().optional(),
  notes: z.unknown().optional(),
});

const entryIdSchema = z.string({ error: "entry_id is required" }).min(1, "entry_id is required");

export const submitEntrySchema = z.object({
  action: z.literal("submit-entry"),
  entry_id: entryIdSchema,
  notes: z.unknown().optional(),
});

export const reviewEntrySchema = z.object({
  action: z.literal("review-entry"),
  entry_id: entryIdSchema,
  status: z.string().nullish(),
  review_notes: z.unknown().optional(),
});

export const logbookDeleteQuerySchema = z.object({
  resource: z.string().optional(),
  id: z.string({ error: "id is required" }).min(1, "id is required"),
});

// ── Aktor & guard ───────────────────────────────────────────────────────

export async function requireLogbookActor(): Promise<LogbookActor> {
  const actor = await getLogbookActor();
  if (!actor) throw ApiError.unauthorized("Unauthorized");
  return actor;
}

const forbidden = () => ApiError.forbidden("Anda tidak berhak mengakses department ini");

function assertDepartment(actor: LogbookActor, departmentId: string) {
  if (!resolveDepartmentScope(actor, departmentId).allowed) throw forbidden();
}

/** Entry + kolom guard (status, department); 404 bila tidak ada. */
async function loadEntryForGuard(db: PgClient, entryId: string) {
  const { data } = await db
    .from("hris_logbook_entries")
    .select("id, status, department_id")
    .eq("id", entryId)
    .maybeSingle();
  if (!data) throw ApiError.notFound("Logbook tidak ditemukan");
  return data as { id: string; status: string; department_id: string };
}

// ── Baca ────────────────────────────────────────────────────────────────

type ListQuery = z.infer<typeof logbookListQuerySchema>;

async function loadMe(db: PgClient, actor: LogbookActor) {
  const [{ data: profile }, { data: employee }] = await Promise.all([
    db.from("users").select("id, full_name, role, brand_id").eq("id", actor.userId).single(),
    db
      .from("employees")
      .select("id, department_id, department:departments(id,name,code)")
      .eq("user_id", actor.userId)
      .maybeSingle(),
  ]);
  return {
    data: {
      ...profile,
      employee,
      can_review: actor.canReview,
      is_full_access: actor.isFullAccess,
    },
  };
}

async function loadEntries(db: PgClient, departmentId: string | null, q: ListQuery) {
  const limit = Math.min(100, Math.max(1, q.limit || 50));
  const page = Math.max(1, q.page || 1);
  const offset = (page - 1) * limit;

  let countQuery = db.from("hris_logbook_entries").select("*", { count: "exact", head: true });
  let query = db
    .from("hris_logbook_entries")
    .select(
      "*, department:departments(id,name,code), template:hris_logbook_templates(id,name,frequency), items:hris_logbook_entry_items(*)"
    )
    .order("entry_date", { ascending: false })
    .range(offset, offset + limit - 1);

  const filters: [string, "eq" | "gte" | "lte", string | null | undefined][] = [
    ["department_id", "eq", departmentId],
    ["status", "eq", q.status],
    ["entry_date", "eq", q.date],
    ["entry_date", "gte", q.from],
    ["entry_date", "lte", q.to],
  ];
  for (const [column, op, value] of filters) {
    if (!value) continue;
    query = query[op](column, value);
    countQuery = countQuery[op](column, value);
  }

  const [result, { count }] = await Promise.all([query, countQuery]);
  return { data: unwrap(result), count: count ?? 0, page, limit };
}

/** GET resource=me|departments|templates|summary|entries. */
export async function readLogbook(actor: LogbookActor, q: ListQuery) {
  const db = await createServerPgClient();

  if (q.resource === "me") return loadMe(db, actor);

  if (q.resource === "departments") {
    // Sengaja tanpa scope: daftar nama department (sensitivitas rendah)
    // dibutuhkan dropdown full-access, tanpa data logbook apa pun.
    const result = await db
      .from("departments")
      .select("id, name, code, is_active")
      .eq("is_active", true)
      .order("name", { ascending: true });
    return { data: unwrap(result) };
  }

  const scope = resolveDepartmentScope(actor, q.department_id);
  if (!scope.allowed) throw forbidden();

  if (q.resource === "templates") {
    let query = db
      .from("hris_logbook_templates")
      .select("*, department:departments(id,name,code), items:hris_logbook_template_items(*)")
      .order("created_at", { ascending: false });
    if (scope.departmentId) query = query.eq("department_id", scope.departmentId);
    if (q.include_inactive !== "true") query = query.eq("is_active", true);
    return { data: unwrap(await query) };
  }

  if (q.resource === "summary") {
    let query = db
      .from("hris_logbook_entries")
      .select(
        "id, department_id, entry_date, status, completion_percentage, kpi_score, department:departments(id,name,code)"
      )
      .order("entry_date", { ascending: false });
    if (scope.departmentId) query = query.eq("department_id", scope.departmentId);
    if (q.from) query = query.gte("entry_date", q.from);
    if (q.to) query = query.lte("entry_date", q.to);
    const entries = (unwrap(await query) ?? []) as LogbookSummaryEntry[];
    return { data: summarizeLogbookEntries(entries) };
  }

  return loadEntries(db, scope.departmentId, q);
}

// ── Tulis ───────────────────────────────────────────────────────────────

export async function createTemplate(actor: LogbookActor, input: z.infer<typeof createTemplateSchema>) {
  // Non-full-access dipaksa ke department sendiri, apa pun isi body.
  const departmentId = actor.isFullAccess ? input.department_id : actor.departmentId;
  if (!departmentId) throw ApiError.badRequest(TEMPLATE_REQUIRED);
  assertDepartment(actor, departmentId);

  const items = (input.items ?? []).filter((item) => item.title?.trim());
  if (!items.length) throw ApiError.badRequest("Minimal satu checklist item harus diisi");

  const db = await createServerPgClient();
  const template = unwrap(
    await db
      .from("hris_logbook_templates")
      .insert({
        department_id: departmentId,
        name: input.name,
        description: input.description || null,
        frequency: input.frequency || "daily",
        is_active: input.is_active ?? true,
        created_by: actor.userId,
      })
      .select()
      .single()
  );

  unwrap(
    await db.from("hris_logbook_template_items").insert(
      items.map((item, index) => ({
        template_id: template.id,
        title: (item.title ?? "").trim(),
        description: item.description || null,
        weight: templateItemWeight(item.weight),
        is_required: item.is_required ?? true,
        sort_order: index,
      }))
    )
  );
  return template;
}

interface TemplateItemRow {
  id: string;
  title: string;
  description: string | null;
  weight: number;
  is_required: boolean;
  sort_order: number;
}

export async function createEntry(actor: LogbookActor, input: z.infer<typeof createEntrySchema>) {
  const db = await createServerPgClient();
  const { data: template } = await db
    .from("hris_logbook_templates")
    .select("*, items:hris_logbook_template_items(*)")
    .eq("id", input.template_id)
    .maybeSingle();
  if (!template) throw ApiError.notFound("Template tidak ditemukan");
  assertDepartment(actor, template.department_id);
  if (!template.is_active) throw ApiError.conflict("Template sudah diarsipkan");

  const note = normalizeLogbookNote(input.notes);
  if (!note.ok) throw ApiError.badRequest("Catatan tidak valid/terlalu panjang");

  const { data: entry, error } = await db
    .from("hris_logbook_entries")
    .insert({
      template_id: template.id,
      department_id: template.department_id,
      entry_date: input.entry_date,
      title: input.title?.trim() || `${template.name} - ${input.entry_date}`,
      notes: note.value,
    })
    .select()
    .single();
  if (error?.code === "23505") {
    throw ApiError.conflict("Logbook untuk template & tanggal ini sudah ada");
  }
  unwrap({ data: entry, error });

  const items = ((template.items ?? []) as TemplateItemRow[]).sort(
    (a, b) => a.sort_order - b.sort_order
  );
  if (items.length) {
    unwrap(
      await db.from("hris_logbook_entry_items").insert(
        items.map((item) => ({
          entry_id: entry.id,
          template_item_id: item.id,
          title: item.title,
          description: item.description,
          weight: item.weight,
          is_required: item.is_required,
          sort_order: item.sort_order,
        }))
      )
    );
  }
  return entry;
}

export async function updateEntryItem(actor: LogbookActor, input: z.infer<typeof updateItemSchema>) {
  const db = await createServerPgClient();
  const { data: item } = await db
    .from("hris_logbook_entry_items")
    .select("id, entry_id")
    .eq("id", input.item_id)
    .maybeSingle();
  if (!item) throw ApiError.notFound("Item tidak ditemukan");

  const entry = await loadEntryForGuard(db, item.entry_id);
  assertDepartment(actor, entry.department_id);
  if (!canEditEntryItems(entry.status)) {
    throw ApiError.conflict("Checklist hanya bisa diubah selama logbook masih draft");
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updated_at: now };
  if (typeof input.is_checked === "boolean") {
    patch.is_checked = input.is_checked;
    patch.checked_by = input.is_checked ? actor.userId : null;
    patch.checked_at = input.is_checked ? now : null;
  }
  if ("notes" in input) {
    const notes = typeof input.notes === "string" ? input.notes : "";
    if (notes.length > LOGBOOK_NOTE_MAX_LENGTH) throw ApiError.badRequest("Catatan terlalu panjang");
    // Disimpan apa adanya; SEMUA render wajib lewat <SafeHtml> (sanitasi
    // DOMPurify allowlist), konsisten dgn modul pengumuman.
    patch.notes = notes || null;
  }

  return unwrap(
    await db.from("hris_logbook_entry_items").update(patch).eq("id", input.item_id).select().single()
  );
}

export async function submitEntry(actor: LogbookActor, input: z.infer<typeof submitEntrySchema>) {
  const db = await createServerPgClient();
  const entry = await loadEntryForGuard(db, input.entry_id);
  assertDepartment(actor, entry.department_id);
  if (!canSubmitEntry(entry.status)) {
    throw ApiError.conflict("Hanya logbook draft yang bisa disubmit");
  }
  const note = normalizeLogbookNote(input.notes);
  if (!note.ok) throw ApiError.badRequest("Catatan tidak valid/terlalu panjang");

  const now = new Date().toISOString();
  return unwrap(
    await db
      .from("hris_logbook_entries")
      .update({
        status: "submitted",
        notes: input.notes === undefined ? undefined : note.value,
        submitted_by: actor.userId,
        submitted_at: now,
        updated_at: now,
      })
      .eq("id", input.entry_id)
      .select()
      .single()
  );
}

export async function reviewEntry(actor: LogbookActor, input: z.infer<typeof reviewEntrySchema>) {
  if (!actor.canReview) throw ApiError.forbidden("Anda tidak berhak me-review logbook");
  const db = await createServerPgClient();
  const entry = await loadEntryForGuard(db, input.entry_id);
  // Scope department tetap dicek walau review roles saat ini subset
  // full-access: mencegah IDOR laten saat LOGBOOK_REVIEW_ROLES diperluas.
  assertDepartment(actor, entry.department_id);
  if (!canReviewEntry(entry.status)) {
    throw ApiError.conflict("Hanya logbook berstatus submitted yang bisa direview");
  }
  const note = normalizeLogbookNote(input.review_notes);
  if (!note.ok) throw ApiError.badRequest("Catatan review tidak valid/terlalu panjang");

  const now = new Date().toISOString();
  return unwrap(
    await db
      .from("hris_logbook_entries")
      .update({
        status: input.status === "rejected" ? "rejected" : "reviewed",
        review_notes: note.value,
        reviewed_by: actor.userId,
        reviewed_at: now,
        updated_at: now,
      })
      .eq("id", input.entry_id)
      .select()
      .single()
  );
}

/** Hapus entry draft. Item checklist ikut terhapus via FK ON DELETE CASCADE. */
export async function deleteEntry(actor: LogbookActor, id: string) {
  const db = await createServerPgClient();
  const entry = await loadEntryForGuard(db, id);
  assertDepartment(actor, entry.department_id);
  if (!canDeleteEntry(entry.status)) {
    throw ApiError.conflict("Hanya logbook draft yang bisa dihapus");
  }
  unwrap(await db.from("hris_logbook_entries").delete().eq("id", id));
  return { message: "Logbook dihapus" };
}

/** Template yang sudah dipakai entry diarsipkan (FK SET NULL memutus riwayat); selain itu dihapus. */
export async function deleteTemplate(actor: LogbookActor, id: string) {
  const db = await createServerPgClient();
  const { data: template } = await db
    .from("hris_logbook_templates")
    .select("id, department_id")
    .eq("id", id)
    .maybeSingle();
  if (!template) throw ApiError.notFound("Template tidak ditemukan");
  assertDepartment(actor, template.department_id);

  const { count } = await db
    .from("hris_logbook_entries")
    .select("*", { count: "exact", head: true })
    .eq("template_id", id);

  if ((count ?? 0) > 0) {
    unwrap(
      await db
        .from("hris_logbook_templates")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", id)
    );
    return { message: "Template diarsipkan (sudah dipakai logbook)", archived: true };
  }

  unwrap(await db.from("hris_logbook_templates").delete().eq("id", id));
  return { message: "Template dihapus", archived: false };
}
