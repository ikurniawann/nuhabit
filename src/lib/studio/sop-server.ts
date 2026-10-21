import { ApiError } from "@/lib/api/auth";
import { query, queryOne, withTransaction } from "@/lib/db";
import { loadDisciplineRules } from "@/lib/studio/coach-discipline-server";
import { loadCoachLeaveSettings } from "@/lib/studio/coach-leave-server";
import { loadComplaintSettings } from "@/lib/studio/complaints-server";
import { buildSopCoachTemplate, SOP_COACH_TEMPLATE_TITLE, sopReminderMessage } from "@/lib/studio/sop";
import { sendStaffWa } from "@/lib/studio/staff-wa";

/**
 * Dokumen SOP coach (EPIC-067 T-067-D1). Setiap terbitan = versi baru yang
 * wajib dikonfirmasi ulang oleh coach aktif venue; versi lama tetap tersimpan.
 */

const portalUrl = () => `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/coach`;

const LATEST = `(SELECT v.* FROM studio.sop_versions v WHERE v.document_id = d.id ORDER BY v.version DESC LIMIT 1)`;

export interface SopListRow {
  id: string;
  title: string;
  is_active: boolean;
  version_id: string;
  version: number;
  published_at: string;
  change_note: string | null;
  coaches_total: number;
  coaches_acked: number;
}

export async function listSopDocuments(branchId: string): Promise<SopListRow[]> {
  return query<SopListRow>(
    `SELECT d.id, lv.title, d.is_active, lv.id AS version_id, lv.version, lv.published_at, lv.change_note,
            (SELECT COUNT(*) FROM studio.coaches c WHERE c.branch_id = d.branch_id AND c.is_active)::int AS coaches_total,
            (SELECT COUNT(*) FROM studio.sop_acknowledgements a JOIN studio.coaches c ON c.id = a.coach_id AND c.is_active
             WHERE a.version_id = lv.id)::int AS coaches_acked
     FROM studio.sop_documents d CROSS JOIN LATERAL ${LATEST} lv
     WHERE d.branch_id = $1
     ORDER BY d.is_active DESC, lv.published_at DESC`,
    [branchId]
  );
}

export interface SopCoachStatus {
  coach_id: string;
  coach_name: string;
  has_login: boolean;
  acknowledged_at: string | null;
}

export async function getSopDocument(branchId: string, id: string) {
  const doc = await queryOne<{ id: string; is_active: boolean; version_id: string; version: number; title: string; body: string; change_note: string | null; published_at: string }>(
    `SELECT d.id, d.is_active, lv.id AS version_id, lv.version, lv.title, lv.body, lv.change_note, lv.published_at
     FROM studio.sop_documents d CROSS JOIN LATERAL ${LATEST} lv
     WHERE d.id = $1 AND d.branch_id = $2`,
    [id, branchId]
  );
  if (!doc) return null;
  const [versions, coaches] = await Promise.all([
    query<{ id: string; version: number; change_note: string | null; published_at: string; published_by_name: string | null; acked: number }>(
      `SELECT v.id, v.version, v.change_note, v.published_at, u.full_name AS published_by_name,
              (SELECT COUNT(*) FROM studio.sop_acknowledgements a WHERE a.version_id = v.id)::int AS acked
       FROM studio.sop_versions v LEFT JOIN configuration.users u ON u.id = v.published_by
       WHERE v.document_id = $1 ORDER BY v.version DESC`,
      [id]
    ),
    query<SopCoachStatus>(
      `SELECT c.id AS coach_id, COALESCE(c.display_name, c.full_name) AS coach_name, (e.user_id IS NOT NULL) AS has_login, a.acknowledged_at
       FROM studio.coaches c
       LEFT JOIN hris.employees e ON e.id = c.employee_id
       LEFT JOIN studio.sop_acknowledgements a ON a.coach_id = c.id AND a.version_id = $2
       WHERE c.branch_id = $1 AND c.is_active
       ORDER BY a.acknowledged_at IS NOT NULL, c.full_name`,
      [branchId, doc.version_id]
    ),
  ]);
  return { ...doc, versions, coaches };
}

export interface SopInput {
  title: string;
  body: string;
  change_note?: string | null;
}

export async function createSopDocument(venue: { companyId: string; branchId: string }, userId: string, input: SopInput): Promise<string> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO studio.sop_documents (company_id, branch_id, title, created_by) VALUES ($1, $2, $3, $4) RETURNING id`,
      [venue.companyId, venue.branchId, input.title.trim(), userId]
    );
    await client.query(
      `INSERT INTO studio.sop_versions (document_id, version, title, body, change_note, published_by) VALUES ($1, 1, $2, $3, $4, $5)`,
      [rows[0].id, input.title.trim(), input.body, input.change_note?.trim() || null, userId]
    );
    return rows[0].id;
  });
}

/** Terbitkan versi baru (nomor berikutnya) — semua coach wajib konfirmasi ulang. */
export async function publishSopVersion(branchId: string, docId: string, userId: string, input: SopInput): Promise<number> {
  return withTransaction(async (client) => {
    const { rows: doc } = await client.query(`SELECT id FROM studio.sop_documents WHERE id = $1 AND branch_id = $2 FOR UPDATE`, [docId, branchId]);
    if (!doc[0]) throw ApiError.notFound("Dokumen SOP tidak ditemukan");
    const { rows } = await client.query<{ version: number }>(
      `INSERT INTO studio.sop_versions (document_id, version, title, body, change_note, published_by)
       SELECT $1, COALESCE(MAX(version), 0) + 1, $2, $3, $4, $5 FROM studio.sop_versions WHERE document_id = $1
       RETURNING version`,
      [docId, input.title.trim(), input.body, input.change_note?.trim() || null, userId]
    );
    await client.query(`UPDATE studio.sop_documents SET title = $2, updated_at = now() WHERE id = $1`, [docId, input.title.trim()]);
    return rows[0].version;
  });
}

export async function setSopActive(branchId: string, docId: string, active: boolean): Promise<void> {
  const rows = await query(`UPDATE studio.sop_documents SET is_active = $3, updated_at = now() WHERE id = $1 AND branch_id = $2 RETURNING id`, [docId, branchId, active]);
  if (rows.length === 0) throw ApiError.notFound("Dokumen SOP tidak ditemukan");
}

/** Template SOP coach dengan angka dari pengaturan venue yang berlaku sekarang. */
export async function sopTemplate(branchId: string): Promise<{ title: string; body: string }> {
  const [leave, complaints, discipline] = await Promise.all([loadCoachLeaveSettings(branchId), loadComplaintSettings(branchId), loadDisciplineRules(branchId)]);
  return {
    title: SOP_COACH_TEMPLATE_TITLE,
    body: buildSopCoachTemplate({
      noticeRules: leave.notice_rules,
      substituteResponseHours: leave.substitute_response_hours,
      memberNoticeMinHours: leave.member_notice_min_hours,
      slaRules: complaints.sla_rules,
      discipline,
    }),
  };
}

/** WA pengingat ke coach aktif (punya akun Coach Portal) yang belum mengonfirmasi versi terbaru (sekali per coach per versi per hari). */
export async function remindUnacknowledged(branchId: string, docId: string): Promise<{ sent: number; pending: number }> {
  const doc = await getSopDocument(branchId, docId);
  if (!doc) throw ApiError.notFound("Dokumen SOP tidak ditemukan");
  if (!doc.is_active) throw ApiError.conflict("Dokumen SOP tidak aktif");
  // Coach tanpa akun Coach Portal tidak bisa konfirmasi → tidak dikirimi pengingat.
  const pending = doc.coaches.filter((c) => !c.acknowledged_at && c.has_login);
  const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
  let sent = 0;
  for (const c of pending) {
    const phone = await queryOne<{ phone: string | null }>(
      `SELECT COALESCE(NULLIF(c.phone, ''), e.phone) AS phone FROM studio.coaches c LEFT JOIN hris.employees e ON e.id = c.employee_id WHERE c.id = $1`,
      [c.coach_id]
    );
    const ok = await sendStaffWa(
      "sop_reminder",
      `sop:${doc.version_id}:${c.coach_id}:${today}`,
      phone?.phone ?? null,
      sopReminderMessage({ coachName: c.coach_name, title: doc.title, version: doc.version, portalUrl: portalUrl() })
    );
    if (ok) sent += 1;
  }
  return { sent, pending: pending.length };
}

// ── Coach Portal ───────────────────────────────────────────────────────────

export interface CoachSopItem {
  document_id: string;
  version_id: string;
  version: number;
  title: string;
  body: string;
  change_note: string | null;
  published_at: string;
  acknowledged_at: string | null;
}

/** Versi terbaru semua SOP aktif venue coach + status konfirmasinya (yang belum dulu). */
export async function coachSopStatus(coach: { id: string; branch_id: string }): Promise<CoachSopItem[]> {
  return query<CoachSopItem>(
    `SELECT d.id AS document_id, lv.id AS version_id, lv.version, lv.title, lv.body, lv.change_note, lv.published_at, a.acknowledged_at
     FROM studio.sop_documents d CROSS JOIN LATERAL ${LATEST} lv
     LEFT JOIN studio.sop_acknowledgements a ON a.version_id = lv.id AND a.coach_id = $1
     WHERE d.branch_id = $2 AND d.is_active
     ORDER BY a.acknowledged_at IS NOT NULL, lv.published_at DESC`,
    [coach.id, coach.branch_id]
  );
}

/** "Saya sudah membaca dan setuju" — hanya untuk versi terbaru SOP aktif di venue coach. */
export async function acknowledgeSop(coach: { id: string; branch_id: string }, userId: string, versionId: string): Promise<void> {
  const ok = await queryOne(
    `SELECT 1 FROM studio.sop_documents d CROSS JOIN LATERAL ${LATEST} lv
     WHERE d.branch_id = $1 AND d.is_active AND lv.id = $2`,
    [coach.branch_id, versionId]
  );
  if (!ok) throw ApiError.conflict("Versi SOP ini sudah tidak berlaku — muat ulang untuk membaca versi terbaru");
  await query(
    `INSERT INTO studio.sop_acknowledgements (version_id, coach_id, user_id) VALUES ($1, $2, $3) ON CONFLICT (version_id, coach_id) DO NOTHING`,
    [versionId, coach.id, userId]
  );
}
