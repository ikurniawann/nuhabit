import type { PoolClient } from "pg";
import { ApiError } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { releaseSessionBookings } from "@/lib/studio/booking-server";
import {
  approverNewLeaveMessage,
  canDirectorDecide,
  canRequestSubstitute,
  coverBlockers,
  type CoverStatus,
  rankSubstitutes,
  sessionStartAt,
  substituteAssignedMessage,
  substituteDeclinedMessage,
  substituteRequestMessage,
  substituteRespondBy,
  type SubstituteCandidate,
} from "@/lib/studio/coach-cover";
import { assertCanDecideCoachLeave, getCoachLeaveApprovers, listCoachSessionsInRange, loadCoachLeaveSettings } from "@/lib/studio/coach-leave-server";
import { flushChangeNoticesSoon, queueSessionChangeNotices } from "@/lib/studio/session-change-server";
import { sendStaffWa } from "@/lib/studio/staff-wa";
import { LEAVE_TYPE_LABELS, type LeaveType } from "@/types/hris";

/**
 * Pengganti coach saat cuti (EPIC-067 T-067-A4) — query & aksi. Semua baris
 * studio.coach_leave_covers milik satu cuti (hris.leaves) dan satu sesi.
 */

const portalUrl = () => `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/coach?tab=leave`;
const backofficeUrl = () => `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/dashboard/studio/coach-leave`;

// ── Konteks cuti coach ─────────────────────────────────────────────────────

export interface CoachLeaveContext {
  leaveId: string;
  status: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  isShortNotice: boolean;
  coachId: string;
  coachName: string;
  companyId: string;
  branchId: string;
  /** User login pengaju (karyawan coach); null bila karyawan belum punya akun. */
  requesterUserId: string | null;
}

/** null = cuti ini bukan milik karyawan yang terhubung ke coach aktif. */
export async function getCoachLeaveContext(leaveId: string): Promise<CoachLeaveContext | null> {
  return queryOne<CoachLeaveContext>(
    `SELECT l.id AS "leaveId", l.status, l.leave_type AS "leaveType", l.start_date::text AS "startDate",
            l.end_date::text AS "endDate", l.is_short_notice AS "isShortNotice",
            c.id AS "coachId", COALESCE(c.display_name, c.full_name) AS "coachName",
            c.company_id AS "companyId", c.branch_id AS "branchId", e.user_id AS "requesterUserId"
     FROM hris.leaves l
     JOIN hris.employees e ON e.id = l.employee_id
     JOIN studio.coaches c ON c.employee_id = e.id AND c.is_active
     WHERE l.id = $1
     ORDER BY c.created_at LIMIT 1`,
    [leaveId]
  );
}

// ── Baris pengganti ────────────────────────────────────────────────────────

export interface CoverRow {
  id: string;
  leave_id: string;
  session_id: string;
  status: CoverStatus;
  original_coach_id: string;
  original_coach_name: string;
  substitute_coach_id: string | null;
  substitute_name: string | null;
  requested_at: string | null;
  respond_by: string | null;
  cancel_reason: string | null;
  note: string | null;
  applied_at: string | null;
  branch_id: string;
  company_id: string;
  session_date: string;
  start_time: string;
  end_time: string;
  session_status: string;
  program_id: string;
  program_name: string;
  program_kind: string;
  booked_count: number;
}

const COVER_SELECT = `
  SELECT cv.id, cv.leave_id, cv.session_id, cv.status, cv.original_coach_id,
         COALESCE(oc.display_name, oc.full_name) AS original_coach_name,
         cv.substitute_coach_id, COALESCE(sc.display_name, sc.full_name) AS substitute_name,
         cv.requested_at, cv.respond_by, cv.cancel_reason, cv.note, cv.applied_at, cv.branch_id, cv.company_id,
         s.session_date::text AS session_date, to_char(s.start_time,'HH24:MI') AS start_time,
         to_char(s.end_time,'HH24:MI') AS end_time, s.status AS session_status,
         p.id AS program_id, p.name AS program_name, p.kind AS program_kind,
         (SELECT COUNT(*) FROM studio.bookings b WHERE b.session_id = s.id AND b.status IN ('booked','attended'))::int AS booked_count
  FROM studio.coach_leave_covers cv
  JOIN studio.class_sessions s ON s.id = cv.session_id
  JOIN studio.programs p ON p.id = s.program_id
  JOIN studio.coaches oc ON oc.id = cv.original_coach_id
  LEFT JOIN studio.coaches sc ON sc.id = cv.substitute_coach_id`;

export async function loadCover(coverId: string): Promise<CoverRow | null> {
  return queryOne<CoverRow>(`${COVER_SELECT} WHERE cv.id = $1`, [coverId]);
}

export async function listLeaveCovers(leaveId: string): Promise<CoverRow[]> {
  return query<CoverRow>(`${COVER_SELECT} WHERE cv.leave_id = $1 AND cv.status <> 'void' ORDER BY s.session_date, s.start_time`, [leaveId]);
}

/** Permintaan yang tidak dijawab sampai batas waktu kembali "butuh pengganti" (dipanggil saat dibaca). */
export async function expireStaleRequests(): Promise<number> {
  const rows = await query(
    `UPDATE studio.coach_leave_covers cv
     SET status = 'open', substitute_coach_id = NULL, updated_at = now(),
         note = 'Tidak dijawab ' || COALESCE((SELECT COALESCE(display_name, full_name) FROM studio.coaches WHERE id = cv.substitute_coach_id), 'pengganti') || ' sebelum batas waktu'
     WHERE status = 'requested' AND respond_by < now()
     RETURNING id`
  );
  return rows.length;
}

/**
 * Samakan baris pengganti dengan sesi yang benar-benar terdampak (cuti masih
 * menunggu): sesi baru di rentang cuti → baris open; sesi yang tidak lagi
 * milik coach / dibatalkan → void.
 */
export async function syncLeaveCovers(ctx: CoachLeaveContext): Promise<void> {
  if (ctx.status !== "pending") return;
  const sessions = await listCoachSessionsInRange(ctx.coachId, ctx.startDate, ctx.endDate);
  for (const s of sessions) {
    await query(
      `INSERT INTO studio.coach_leave_covers (company_id, branch_id, leave_id, session_id, original_coach_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (leave_id, session_id) DO UPDATE
         SET status = CASE WHEN coach_leave_covers.status = 'void' AND coach_leave_covers.applied_at IS NULL THEN 'open' ELSE coach_leave_covers.status END,
             updated_at = now()`,
      [ctx.companyId, ctx.branchId, ctx.leaveId, s.id, ctx.coachId]
    );
  }
  await query(
    `UPDATE studio.coach_leave_covers SET status = 'void', note = 'Sesi tidak lagi terdampak', updated_at = now()
     WHERE leave_id = $1 AND status <> 'void' AND applied_at IS NULL AND NOT (session_id = ANY($2::uuid[]))`,
    [ctx.leaveId, sessions.map((s) => s.id)]
  );
}

export async function voidLeaveCovers(leaveId: string, note: string): Promise<void> {
  await query(
    `UPDATE studio.coach_leave_covers SET status = 'void', note = $2, updated_at = now()
     WHERE leave_id = $1 AND status <> 'void' AND applied_at IS NULL`,
    [leaveId, note]
  );
}

// ── Saran pengganti ────────────────────────────────────────────────────────

/** Semua coach aktif venue (selain yang cuti) dengan tanda bentrok/cuti/program/beban; dipakai coach & PD. */
export async function listSubstituteCandidates(cover: CoverRow): Promise<SubstituteCandidate[]> {
  return query<SubstituteCandidate>(
    `SELECT c.id AS coach_id, COALESCE(c.display_name, c.full_name) AS name,
            (EXISTS (
               SELECT 1 FROM studio.class_sessions o
               WHERE o.coach_id = c.id AND o.session_date = $2::date AND o.status <> 'cancelled'
                 AND o.start_time < $4::time AND o.end_time > $3::time
             ) OR EXISTS (
               SELECT 1 FROM studio.coach_leave_covers x JOIN studio.class_sessions xs ON xs.id = x.session_id
               WHERE x.substitute_coach_id = c.id AND x.id <> $6 AND x.applied_at IS NULL
                 AND x.status IN ('requested','accepted','assigned')
                 AND xs.session_date = $2::date AND xs.start_time < $4::time AND xs.end_time > $3::time
             )) AS clash,
            (EXISTS (
               SELECT 1 FROM studio.coach_time_off t WHERE t.coach_id = c.id AND $2::date BETWEEN t.date_from AND t.date_to
             ) OR EXISTS (
               SELECT 1 FROM hris.leaves l WHERE l.employee_id = c.employee_id AND l.status = 'approved'
                 AND $2::date BETWEEN l.start_date AND l.end_date
             )) AS on_leave,
            (EXISTS (SELECT 1 FROM studio.coach_programs cp WHERE cp.coach_id = c.id AND cp.program_id = $5)
             OR EXISTS (SELECT 1 FROM studio.class_sessions h WHERE h.coach_id = c.id AND h.program_id = $5 AND h.status = 'completed')) AS teaches_program,
            (SELECT COUNT(*) FROM studio.class_sessions w
             WHERE w.coach_id = c.id AND w.status <> 'cancelled'
               AND date_trunc('week', w.session_date) = date_trunc('week', $2::date))::int AS week_load
     FROM studio.coaches c
     WHERE c.branch_id = $1 AND c.is_active AND c.id <> $7
     ORDER BY name`,
    [cover.branch_id, cover.session_date, cover.start_time, cover.end_time, cover.program_id, cover.id, cover.original_coach_id]
  );
}

export async function suggestSubstitutes(cover: CoverRow): Promise<SubstituteCandidate[]> {
  return rankSubstitutes(await listSubstituteCandidates(cover), cover.program_kind);
}

async function assertSuggested(cover: CoverRow, substituteId: string) {
  const ranked = await suggestSubstitutes(cover);
  if (!ranked.some((c) => c.coach_id === substituteId)) {
    throw ApiError.conflict("Coach ini tidak tersedia di jam itu (bentrok, sedang cuti, atau tidak membawakan program ini)");
  }
}

async function assertLeavePending(leaveId: string) {
  const leave = await queryOne<{ status: string }>(`SELECT status FROM hris.leaves WHERE id = $1`, [leaveId]);
  if (leave?.status !== "pending") throw ApiError.conflict("Cuti ini sudah diproses — pengganti tidak bisa diubah lagi");
}

// ── Aksi coach (Coach Portal) ──────────────────────────────────────────────

export async function requestSubstitute(coverId: string, requesterCoachId: string, substituteId: string, now = new Date()) {
  await expireStaleRequests();
  const cover = await loadCover(coverId);
  if (!cover || cover.original_coach_id !== requesterCoachId) throw ApiError.notFound("Sesi tidak ditemukan");
  if (!canRequestSubstitute(cover.status)) throw ApiError.conflict("Sesi ini sudah punya pengganti atau sedang menunggu jawaban");
  await assertLeavePending(cover.leave_id);
  await assertSuggested(cover, substituteId);
  const settings = await loadCoachLeaveSettings(cover.branch_id);
  const respondBy = substituteRespondBy(now, settings.substitute_response_hours, sessionStartAt(cover.session_date, cover.start_time));
  const rows = await query(
    `UPDATE studio.coach_leave_covers
     SET status = 'requested', substitute_coach_id = $2, requested_at = now(), respond_by = $3,
         responded_at = NULL, note = NULL, updated_at = now()
     WHERE id = $1 AND status = 'open' RETURNING id`,
    [coverId, substituteId, respondBy.toISOString()]
  );
  if (rows.length === 0) throw ApiError.conflict("Sesi ini baru saja berubah — muat ulang");
  void notifyCoach(substituteId, `cover-request:${coverId}:${respondBy.getTime()}`, (name) =>
    substituteRequestMessage({ substituteName: name, requesterName: cover.original_coach_name, session: cover, respondBy, portalUrl: portalUrl() })
  );
  return { respond_by: respondBy.toISOString() };
}

export async function respondToSubstituteRequest(coverId: string, meCoachId: string, accept: boolean) {
  await expireStaleRequests();
  const cover = await loadCover(coverId);
  if (!cover || cover.substitute_coach_id !== meCoachId || cover.status !== "requested") {
    throw ApiError.conflict("Permintaan ini sudah tidak berlaku (sudah dijawab, lewat batas waktu, atau dialihkan)");
  }
  if (accept) {
    const mine = (await listSubstituteCandidates(cover)).find((c) => c.coach_id === meCoachId);
    if (mine?.clash || mine?.on_leave) throw ApiError.conflict("Anda sudah punya jadwal atau cuti di jam itu");
  }
  const rows = await query(
    accept
      ? `UPDATE studio.coach_leave_covers SET status = 'accepted', responded_at = now(), updated_at = now()
         WHERE id = $1 AND status = 'requested' AND substitute_coach_id = $2 RETURNING id`
      : `UPDATE studio.coach_leave_covers
         SET status = 'open', substitute_coach_id = NULL, responded_at = now(), updated_at = now(),
             note = 'Ditolak ' || $3
         WHERE id = $1 AND status = 'requested' AND substitute_coach_id = $2 RETURNING id`,
    accept ? [coverId, meCoachId] : [coverId, meCoachId, cover.substitute_name ?? "pengganti"]
  );
  if (rows.length === 0) throw ApiError.conflict("Permintaan ini baru saja berubah — muat ulang");
  if (!accept) {
    void notifyCoach(cover.original_coach_id, `cover-declined:${coverId}:${Date.now()}`, (name) =>
      substituteDeclinedMessage({ requesterName: name, substituteName: cover.substitute_name ?? "Pengganti", session: cover, portalUrl: portalUrl() })
    );
  }
}

/** Permintaan menggantikan yang ditujukan ke coach ini (menunggu jawaban + yang sudah diterima/ditunjuk). */
export async function listIncomingRequests(meCoachId: string): Promise<CoverRow[]> {
  await expireStaleRequests();
  return query<CoverRow>(
    `${COVER_SELECT}
     JOIN hris.leaves l ON l.id = cv.leave_id
     WHERE cv.substitute_coach_id = $1 AND cv.status IN ('requested','accepted','assigned')
       AND cv.applied_at IS NULL AND l.status = 'pending' AND s.status = 'scheduled'
     ORDER BY s.session_date, s.start_time`,
    [meCoachId]
  );
}

// ── Aksi Program Director (backoffice) ─────────────────────────────────────

async function loadDecidableCover(coverId: string, branchId: string, actor: { id: string; role: string }) {
  const cover = await loadCover(coverId);
  if (!cover || cover.branch_id !== branchId) throw ApiError.notFound("Sesi tidak ditemukan");
  if (!canDirectorDecide(cover.status)) throw ApiError.conflict("Sesi ini sudah tidak terdampak cuti");
  const ctx = await getCoachLeaveContext(cover.leave_id);
  if (!ctx || ctx.status !== "pending") throw ApiError.conflict("Cuti ini sudah diproses — pengganti tidak bisa diubah lagi");
  await assertCanDecideCoachLeave(branchId, actor, ctx.requesterUserId);
  return cover;
}

export async function assignSubstitute(coverId: string, branchId: string, actor: { id: string; role: string }, substituteId: string) {
  const cover = await loadDecidableCover(coverId, branchId, actor);
  await assertSuggested(cover, substituteId);
  await query(
    `UPDATE studio.coach_leave_covers
     SET status = 'assigned', substitute_coach_id = $2, decided_by = $3, respond_by = NULL,
         cancel_reason = NULL, note = NULL, updated_at = now()
     WHERE id = $1`,
    [coverId, substituteId, actor.id]
  );
  void notifyCoach(substituteId, `cover-assigned:${coverId}:${substituteId}`, (name) =>
    substituteAssignedMessage({ substituteName: name, requesterName: cover.original_coach_name, session: cover, portalUrl: portalUrl() })
  );
}

export async function markCoverCancelClass(coverId: string, branchId: string, actor: { id: string; role: string }, reason: string) {
  await loadDecidableCover(coverId, branchId, actor);
  await query(
    `UPDATE studio.coach_leave_covers
     SET status = 'cancel', substitute_coach_id = NULL, decided_by = $2, respond_by = NULL,
         cancel_reason = $3, note = NULL, updated_at = now()
     WHERE id = $1`,
    [coverId, actor.id, reason]
  );
}

export interface PendingCoachLeave extends CoachLeaveContext {
  totalDays: number;
  reason: string;
  noticeDays: number | null;
  createdAt: string;
  covers: CoverRow[];
}

/** Antrean Program Director: cuti coach yang menunggu, mendadak dulu lalu tanggal mulai. */
export async function listPendingCoachLeaves(branchId: string): Promise<PendingCoachLeave[]> {
  await expireStaleRequests();
  const leaves = await query<PendingCoachLeave>(
    `SELECT l.id AS "leaveId", l.status, l.leave_type AS "leaveType", l.start_date::text AS "startDate",
            l.end_date::text AS "endDate", l.is_short_notice AS "isShortNotice", l.total_days::float AS "totalDays",
            l.reason, l.notice_days AS "noticeDays", l.created_at AS "createdAt",
            c.id AS "coachId", COALESCE(c.display_name, c.full_name) AS "coachName",
            c.company_id AS "companyId", c.branch_id AS "branchId", e.user_id AS "requesterUserId"
     FROM hris.leaves l
     JOIN hris.employees e ON e.id = l.employee_id
     JOIN studio.coaches c ON c.employee_id = e.id AND c.is_active
     WHERE l.status = 'pending' AND c.branch_id = $1
     ORDER BY l.is_short_notice DESC, l.start_date, l.created_at`,
    [branchId]
  );
  for (const leave of leaves) {
    await syncLeaveCovers(leave);
    leave.covers = await listLeaveCovers(leave.leaveId);
  }
  return leaves;
}

// ── Persetujuan (dipanggil route approve HRIS) ─────────────────────────────

export interface AppliedCovers {
  swapped: number;
  swappedSessions: string[];
  cancelled: { sessionId: string; reason: string }[];
}

/**
 * Terapkan pengganti di dalam transaksi persetujuan: semua baris harus sudah
 * tertangani; coach sesi diganti (coach asli disimpan) atau sesi dibatalkan.
 * Pelepasan booking sesi batal + kabar ke member dilakukan sesudah commit (finalizeAppliedCovers).
 */
export async function applyCoversOnApproval(client: PoolClient, leaveId: string): Promise<AppliedCovers> {
  const { rows } = await client.query<{
    id: string; status: CoverStatus; session_id: string; original_coach_id: string; substitute_coach_id: string | null;
    cancel_reason: string | null; session_date: string; start_time: string; end_time: string; session_status: string;
  }>(
    `SELECT cv.id, cv.status, cv.session_id, cv.original_coach_id, cv.substitute_coach_id, cv.cancel_reason,
            s.session_date::text AS session_date, s.start_time::text AS start_time, s.end_time::text AS end_time, s.status AS session_status
     FROM studio.coach_leave_covers cv JOIN studio.class_sessions s ON s.id = cv.session_id
     WHERE cv.leave_id = $1 AND cv.status <> 'void' AND cv.applied_at IS NULL
     FOR UPDATE OF cv, s`,
    [leaveId]
  );
  const blockers = coverBlockers(rows);
  if (blockers.length > 0) {
    throw ApiError.conflict(`Masih ada ${blockers.length} sesi tanpa pengganti — tunjuk pengganti atau batalkan kelasnya dulu`);
  }
  const out: AppliedCovers = { swapped: 0, swappedSessions: [], cancelled: [] };
  for (const r of rows) {
    if (r.session_status !== "scheduled") {
      await client.query(`UPDATE studio.coach_leave_covers SET status = 'void', note = 'Sesi sudah tidak terjadwal', updated_at = now() WHERE id = $1`, [r.id]);
      continue;
    }
    if (r.status === "cancel") {
      const reason = r.cancel_reason ?? "coach cuti";
      await client.query(
        `UPDATE studio.class_sessions SET status = 'cancelled', cancel_reason = $2, updated_at = now() WHERE id = $1`,
        [r.session_id, reason]
      );
      out.cancelled.push({ sessionId: r.session_id, reason });
    } else {
      const clash = await client.query(
        `SELECT 1 FROM studio.class_sessions o
         WHERE o.coach_id = $1 AND o.id <> $2 AND o.session_date = $3::date AND o.status <> 'cancelled'
           AND o.start_time < $5::time AND o.end_time > $4::time LIMIT 1`,
        [r.substitute_coach_id, r.session_id, r.session_date, r.start_time, r.end_time]
      );
      if (clash.rows.length > 0) {
        throw ApiError.conflict(`Pengganti untuk sesi ${r.session_date} ${r.start_time.slice(0, 5)} sekarang bentrok dengan jadwal lain — tunjuk ulang`);
      }
      await client.query(
        `UPDATE studio.class_sessions SET coach_id = $2, original_coach_id = COALESCE(original_coach_id, $3), updated_at = now() WHERE id = $1`,
        [r.session_id, r.substitute_coach_id, r.original_coach_id]
      );
      out.swapped += 1;
      out.swappedSessions.push(r.session_id);
    }
    await client.query(`UPDATE studio.coach_leave_covers SET applied_at = now(), updated_at = now() WHERE id = $1`, [r.id]);
  }
  return out;
}

/**
 * T-067-A5 — cuti coach yang disetujui menjadi time-off coach (di dalam
 * transaksi persetujuan): slot Personal Training tertutup dan generate jadwal
 * tidak memasang coach ini di tanggal cutinya. Idempoten per cuti.
 */
export async function syncLeaveTimeOff(client: PoolClient, ctx: CoachLeaveContext, label: string): Promise<void> {
  await client.query(
    `INSERT INTO studio.coach_time_off (company_id, branch_id, coach_id, date_from, date_to, reason, leave_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (leave_id) WHERE leave_id IS NOT NULL DO NOTHING`,
    [ctx.companyId, ctx.branchId, ctx.coachId, ctx.startDate, ctx.endDate, label, ctx.leaveId]
  );
}

/** Cuti dibatalkan → time-off hasil sinkron ikut dihapus (time-off manual tidak tersentuh). */
export async function removeLeaveTimeOff(leaveId: string): Promise<void> {
  await query(`DELETE FROM studio.coach_time_off WHERE leave_id = $1`, [leaveId]);
}

/**
 * Sesudah commit: kabari member (T-067-A6) — sesi batal diantrekan SEBELUM
 * booking dilepas & kredit dikembalikan, sesi yang coach-nya diganti
 * diantrekan langsung; lalu kirim yang boleh dikirim sekarang.
 */
export async function finalizeAppliedCovers(ctx: CoachLeaveContext, actorUserId: string, applied: AppliedCovers): Promise<number> {
  let released = 0;
  for (const c of applied.cancelled) {
    await queueSessionChangeNotices(c.sessionId, { kind: "cancelled" });
    released += await releaseSessionBookings(
      { companyId: ctx.companyId, branchId: ctx.branchId, actorId: actorUserId, staff: true },
      c.sessionId,
      c.reason
    );
    flushChangeNoticesSoon(c.sessionId);
  }
  for (const sessionId of applied.swappedSessions) {
    await queueSessionChangeNotices(sessionId, { kind: "coach_changed", oldCoachName: ctx.coachName });
    flushChangeNoticesSoon(sessionId);
  }
  return released;
}

// ── WA staf ────────────────────────────────────────────────────────────────

/** Fire-and-forget: WA ke coach (nomor profil coach, fallback nomor karyawan). */
async function notifyCoach(coachId: string, dedupKey: string, build: (name: string) => string) {
  try {
    const coach = await queryOne<{ name: string; phone: string | null }>(
      `SELECT COALESCE(c.display_name, c.full_name) AS name, COALESCE(NULLIF(c.phone, ''), e.phone) AS phone
       FROM studio.coaches c LEFT JOIN hris.employees e ON e.id = c.employee_id WHERE c.id = $1`,
      [coachId]
    );
    if (coach) await sendStaffWa("coach_cover", dedupKey, coach.phone, build(coach.name));
  } catch (err) {
    console.error("[coach-cover] WA coach gagal:", err);
  }
}

/** Fire-and-forget saat coach mengajukan cuti: buat baris pengganti, kabari approver yang aktif. */
export async function onCoachLeaveSubmitted(leaveId: string): Promise<void> {
  try {
    const ctx = await getCoachLeaveContext(leaveId);
    if (!ctx) return;
    await syncLeaveCovers(ctx);
    const covers = await listLeaveCovers(leaveId);
    const { resolved } = await getCoachLeaveApprovers(ctx.branchId, ctx.requesterUserId);
    const range = ctx.startDate === ctx.endDate ? ctx.startDate : `${ctx.startDate} s.d. ${ctx.endDate}`;
    for (const a of resolved.approvers) {
      const emp = await queryOne<{ phone: string | null }>(`SELECT phone FROM hris.employees WHERE user_id = $1 LIMIT 1`, [a.userId]);
      await sendStaffWa(
        "coach_cover",
        `coach-leave:${leaveId}:${a.userId}`,
        emp?.phone ?? null,
        approverNewLeaveMessage({
          approverName: a.name,
          coachName: ctx.coachName,
          leaveLabel: LEAVE_TYPE_LABELS[ctx.leaveType] ?? ctx.leaveType,
          range,
          sessions: covers.length,
          shortNotice: ctx.isShortNotice,
          backofficeUrl: backofficeUrl(),
        })
      );
    }
  } catch (err) {
    console.error("[coach-cover] notifikasi cuti coach gagal:", err);
  }
}
