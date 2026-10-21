import { ApiError } from "@/lib/api/auth";
import { query, queryOne, withTransaction } from "@/lib/db";
import type { CsCategory, CsPriority } from "@/lib/crm/cs-rules";
import {
  categoryFromCs,
  type ComplaintCategory,
  complaintCode,
  complaintDeadlines,
  type ComplaintPriority,
  type ComplaintSource,
  type ComplaintStatus,
  complaintTitle,
  defaultComplaintPriority,
} from "@/lib/studio/complaints";
import { normalizeMemberPhone, VENUE_TODAY_SQL } from "@/lib/studio/pass-server";

/** Tiket keluhan pelanggan (EPIC-067 T-067-B1) — query & pembuatan. */

export interface ComplaintInput {
  source: ComplaintSource;
  category: ComplaintCategory;
  priority?: ComplaintPriority;
  title?: string | null;
  description?: string | null;
  customer_id?: string | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  coach_id?: string | null;
  session_id?: string | null;
  wa_conversation_id?: string | null;
}

export interface ComplaintRow {
  id: string;
  code: string;
  source: ComplaintSource;
  category: ComplaintCategory;
  priority: ComplaintPriority;
  status: ComplaintStatus;
  title: string;
  description: string | null;
  customer_id: string | null;
  member_name: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  coach_id: string | null;
  coach_name: string | null;
  session_id: string | null;
  session_label: string | null;
  wa_conversation_id: string | null;
  assignee_user_id: string | null;
  assignee_name: string | null;
  respond_by: string | null;
  resolve_by: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  created_by_name: string | null;
  created_at: string;
}

const COMPLAINT_SELECT = `
  SELECT k.id, k.code, k.source, k.category, k.priority, k.status, k.title, k.description,
         k.customer_id, c.name AS member_name, k.contact_name, k.contact_phone,
         k.coach_id, COALESCE(co.display_name, co.full_name) AS coach_name,
         k.session_id,
         CASE WHEN s.id IS NULL THEN NULL ELSE p.name || ' · ' || to_char(s.session_date, 'DD/MM') || ' ' || to_char(s.start_time, 'HH24:MI') END AS session_label,
         k.wa_conversation_id, k.assignee_user_id, au.full_name AS assignee_name,
         k.respond_by, k.resolve_by, k.first_response_at, k.resolved_at,
         cu.full_name AS created_by_name, k.created_at
  FROM studio.complaints k
  LEFT JOIN pos.pos_customers c ON c.id = k.customer_id
  LEFT JOIN studio.coaches co ON co.id = k.coach_id
  LEFT JOIN studio.class_sessions s ON s.id = k.session_id
  LEFT JOIN studio.programs p ON p.id = s.program_id
  LEFT JOIN configuration.users au ON au.id = k.assignee_user_id
  LEFT JOIN configuration.users cu ON cu.id = k.created_by`;

async function assertInVenue(branchId: string, input: ComplaintInput) {
  if (input.customer_id && !(await queryOne(`SELECT 1 FROM pos.pos_customers WHERE id = $1`, [input.customer_id]))) {
    throw ApiError.notFound("Member tidak ditemukan");
  }
  if (input.coach_id && !(await queryOne(`SELECT 1 FROM studio.coaches WHERE id = $1 AND branch_id = $2`, [input.coach_id, branchId]))) {
    throw ApiError.notFound("Coach tidak ditemukan");
  }
}

/** Sesi tertaut menentukan coach bila staf tidak memilih coach. */
async function sessionCoach(branchId: string, sessionId: string): Promise<string | null> {
  const s = await queryOne<{ coach_id: string | null }>(`SELECT coach_id FROM studio.class_sessions WHERE id = $1 AND branch_id = $2`, [sessionId, branchId]);
  if (!s) throw ApiError.notFound("Sesi tidak ditemukan");
  return s.coach_id;
}

export async function createComplaint(
  venue: { companyId: string; branchId: string },
  userId: string,
  input: ComplaintInput,
  now = new Date()
): Promise<{ id: string; code: string }> {
  await assertInVenue(venue.branchId, input);
  const coachId = input.coach_id ?? (input.session_id ? await sessionCoach(venue.branchId, input.session_id) : null);
  const priority = input.priority ?? defaultComplaintPriority(input.category);
  const { respondBy, resolveBy } = complaintDeadlines(input.category, now);
  const phone = input.contact_phone ? (normalizeMemberPhone(input.contact_phone) ?? input.contact_phone.trim()) : null;
  const title = complaintTitle(input.title, input.description, input.category);

  return withTransaction(async (client) => {
    // Kode berurutan per bulan (unik lintas venue); kunci per prefix supaya dua tiket bersamaan tidak berebut nomor.
    const prefix = complaintCode(now, 0).slice(0, 9); // "KEL-2610-"
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('studio.complaints:' || $1))`, [prefix]);
    const { rows: seqRows } = await client.query<{ n: number }>(
      `SELECT COALESCE(MAX(substring(code from 10)::int), 0) + 1 AS n FROM studio.complaints WHERE code LIKE $1`,
      [`${prefix}%`]
    );
    const code = complaintCode(now, seqRows[0].n);
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO studio.complaints (company_id, branch_id, code, source, category, priority, title, description,
         customer_id, contact_name, contact_phone, coach_id, session_id, wa_conversation_id, respond_by, resolve_by, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
      [
        venue.companyId, venue.branchId, code, input.source, input.category, priority, title, input.description?.trim() || null,
        input.customer_id ?? null, input.contact_name?.trim() || null, phone, coachId, input.session_id ?? null,
        input.wa_conversation_id ?? null, respondBy.toISOString(), resolveBy.toISOString(), userId,
      ]
    );
    await client.query(
      `INSERT INTO studio.complaint_events (complaint_id, kind, to_status, actor_user_id) VALUES ($1, 'created', 'received', $2)`,
      [rows[0].id, userId]
    );
    return { id: rows[0].id, code };
  });
}

/**
 * Tiket dari percakapan WA inbox (satu klik): kontak, member, dan prioritas
 * diambil dari percakapan; percakapan ditandai komplain. Bila sudah ada tiket
 * aktif untuk percakapan itu → 409 berisi tiketnya.
 */
export async function createComplaintFromWa(
  venue: { companyId: string; branchId: string },
  userId: string,
  conversationId: string,
  override: Partial<Pick<ComplaintInput, "category" | "priority" | "title" | "description" | "coach_id" | "session_id">> = {}
): Promise<{ id: string; code: string }> {
  const conv = await queryOne<{ phone: string | null; customer_id: string | null; display_name: string | null; category: CsCategory | null; priority: CsPriority | null; last_message_preview: string | null }>(
    `SELECT phone, customer_id, display_name, category, priority, last_message_preview FROM crm.wa_conversations WHERE id = $1`,
    [conversationId]
  );
  if (!conv) throw ApiError.notFound("Percakapan tidak ditemukan");
  const existing = await findOpenWaComplaint(conversationId);
  if (existing) throw new ApiError(409, `Percakapan ini sudah punya tiket ${existing.code}`, existing);

  const category = override.category ?? categoryFromCs(conv.category);
  const created = await createComplaint(venue, userId, {
    source: "wa",
    category,
    priority: override.priority ?? (conv.priority && conv.priority !== "normal" ? conv.priority : defaultComplaintPriority(category)),
    title: override.title,
    description: override.description ?? conv.last_message_preview,
    customer_id: conv.customer_id,
    contact_name: conv.display_name,
    contact_phone: conv.phone,
    coach_id: override.coach_id ?? null,
    session_id: override.session_id ?? null,
    wa_conversation_id: conversationId,
  });
  await query(`UPDATE crm.wa_conversations SET is_complaint = true, updated_at = now() WHERE id = $1 AND is_complaint IS NOT TRUE`, [conversationId]);
  return created;
}

export async function findOpenWaComplaint(conversationId: string): Promise<{ id: string; code: string; status: ComplaintStatus } | null> {
  return queryOne(
    `SELECT id, code, status FROM studio.complaints
     WHERE wa_conversation_id = $1 AND status NOT IN ('confirmed','cancelled') ORDER BY created_at DESC LIMIT 1`,
    [conversationId]
  );
}

export interface ComplaintFilters {
  status?: ComplaintStatus | "open";
  category?: ComplaintCategory;
  q?: string;
}

export async function listComplaints(branchId: string, f: ComplaintFilters = {}): Promise<ComplaintRow[]> {
  const where = ["k.branch_id = $1"];
  const params: unknown[] = [branchId];
  if (f.status === "open") where.push(`k.status IN ('received','in_progress')`);
  else if (f.status) {
    params.push(f.status);
    where.push(`k.status = $${params.length}`);
  }
  if (f.category) {
    params.push(f.category);
    where.push(`k.category = $${params.length}`);
  }
  if (f.q?.trim()) {
    params.push(`%${f.q.trim()}%`);
    where.push(`(k.code ILIKE $${params.length} OR k.title ILIKE $${params.length} OR c.name ILIKE $${params.length} OR k.contact_name ILIKE $${params.length})`);
  }
  return query<ComplaintRow>(
    `${COMPLAINT_SELECT} WHERE ${where.join(" AND ")}
     ORDER BY CASE WHEN k.status IN ('received','in_progress') THEN 0 ELSE 1 END,
              CASE k.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
              k.created_at DESC
     LIMIT 200`,
    params
  );
}

export interface ComplaintEvent {
  id: string;
  kind: string;
  from_status: string | null;
  to_status: string | null;
  body: string | null;
  actor_name: string | null;
  created_at: string;
}

export async function getComplaint(branchId: string, id: string): Promise<(ComplaintRow & { events: ComplaintEvent[] }) | null> {
  const row = await queryOne<ComplaintRow>(`${COMPLAINT_SELECT} WHERE k.id = $1 AND k.branch_id = $2`, [id, branchId]);
  if (!row) return null;
  const events = await query<ComplaintEvent>(
    `SELECT e.id, e.kind, e.from_status, e.to_status, e.body, u.full_name AS actor_name, e.created_at
     FROM studio.complaint_events e LEFT JOIN configuration.users u ON u.id = e.actor_user_id
     WHERE e.complaint_id = $1 ORDER BY e.created_at`,
    [id]
  );
  return { ...row, events };
}

/** Sesi member 30 hari terakhir s/d 7 hari ke depan — untuk menautkan keluhan ke kelas & coach. */
export async function memberSessionsForComplaint(branchId: string, customerId: string) {
  return query<{ id: string; label: string; coach_id: string | null; coach_name: string | null }>(
    `SELECT s.id, p.name || ' · ' || to_char(s.session_date, 'DD/MM') || ' ' || to_char(s.start_time, 'HH24:MI') AS label,
            s.coach_id, COALESCE(co.display_name, co.full_name) AS coach_name
     FROM studio.bookings b
     JOIN studio.class_sessions s ON s.id = b.session_id
     JOIN studio.programs p ON p.id = s.program_id
     LEFT JOIN studio.coaches co ON co.id = s.coach_id
     WHERE b.customer_id = $1 AND s.branch_id = $2
       AND s.session_date BETWEEN ${VENUE_TODAY_SQL} - 30 AND ${VENUE_TODAY_SQL} + 7
     ORDER BY s.session_date DESC, s.start_time DESC
     LIMIT 30`,
    [customerId, branchId]
  );
}
