import { query, queryOne } from "@/lib/db";
import { loadCoachLeaveSettings } from "@/lib/studio/coach-leave-server";
import { sessionStartAt } from "@/lib/studio/coach-cover";
import { normalizeMemberPhone } from "@/lib/studio/pass-server";
import {
  canSendChangeNow,
  changeDedupKey,
  coachChangedMessage,
  isChangeNoticeLate,
  sessionCancelledMessage,
  type SessionChangeKind,
} from "@/lib/studio/session-change";
import { sendWhatsAppText } from "@/lib/whatsapp";

/**
 * Kabar ke member saat coach diganti / kelas dibatalkan (EPIC-067 T-067-A6).
 * Dua langkah: queue (klaim baris member_notifications per booking, status
 * pending — untuk batal kelas dipanggil SEBELUM booking dilepas) lalu flush
 * (kirim yang boleh dikirim sekarang; sisanya menunggu jam layak, dikirim
 * watcher job). Ini pesan layanan: tetap dikirim walau member mematikan
 * pengingat WA.
 */

const memberAppUrl = () => `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/member`;

const CHANGE_KINDS = ["session_coach_changed", "session_cancelled", "session_rescheduled"] as const;

export type SessionChange =
  | { kind: "coach_changed"; oldCoachName: string | null }
  | { kind: "cancelled" };

interface SessionInfo {
  id: string;
  branch_id: string;
  session_date: string;
  start_time: string;
  program_name: string;
  program_kind: string;
  coach_id: string | null;
  coach_name: string | null;
}

/** Catat perubahan di sesi dan antrekan WA untuk member yang booking / waitlist. */
export async function queueSessionChangeNotices(sessionId: string, change: SessionChange, now = new Date()): Promise<{ queued: number; late: boolean }> {
  const s = await queryOne<SessionInfo>(
    `SELECT s.id, s.branch_id, s.session_date::text AS session_date, to_char(s.start_time,'HH24:MI') AS start_time,
            p.name AS program_name, p.kind AS program_kind, s.coach_id, COALESCE(c.display_name, c.full_name) AS coach_name
     FROM studio.class_sessions s JOIN studio.programs p ON p.id = s.program_id
     LEFT JOIN studio.coaches c ON c.id = s.coach_id
     WHERE s.id = $1`,
    [sessionId]
  );
  if (!s) return { queued: 0, late: false };
  if (change.kind === "coach_changed" && !s.coach_id) return { queued: 0, late: false };

  const settings = await loadCoachLeaveSettings(s.branch_id);
  const late = isChangeNoticeLate(sessionStartAt(s.session_date, s.start_time), now, settings.member_notice_min_hours);
  const kind: SessionChangeKind = change.kind;
  await query(
    `UPDATE studio.class_sessions
     SET changed_at = now(), change_kind = $2::varchar, change_notice_late = $3,
         coach_changed_at = CASE WHEN $2::varchar = 'coach_changed' THEN now() ELSE coach_changed_at END
     WHERE id = $1`,
    [sessionId, kind, late]
  );

  const recipients = await query<{ booking_id: string; customer_id: string; name: string | null; phone: string | null; status: string }>(
    `SELECT b.id AS booking_id, b.customer_id, c.name, c.phone, b.status
     FROM studio.bookings b JOIN pos.pos_customers c ON c.id = b.customer_id
     WHERE b.session_id = $1 AND b.status IN ('booked','waitlisted')`,
    [sessionId]
  );
  let queued = 0;
  for (const r of recipients) {
    const input = {
      name: r.name,
      program: s.program_name,
      kind: s.program_kind,
      date: s.session_date,
      time: s.start_time,
      waitlisted: r.status === "waitlisted",
      link: memberAppUrl(),
    };
    const message =
      change.kind === "coach_changed"
        ? coachChangedMessage({ ...input, newCoach: s.coach_name ?? "Another coach", oldCoach: change.oldCoachName })
        : sessionCancelledMessage(input);
    const key = change.kind === "coach_changed" ? changeDedupKey.coachChanged(r.booking_id, s.coach_id!) : changeDedupKey.cancelled(r.booking_id);
    const phone = r.phone ? normalizeMemberPhone(r.phone) : null;
    const row = await queryOne<{ id: string }>(
      `INSERT INTO studio.member_notifications (branch_id, customer_id, kind, dedup_key, phone, message, status, error, session_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (dedup_key) DO NOTHING RETURNING id`,
      [
        s.branch_id,
        r.customer_id,
        change.kind === "coach_changed" ? "session_coach_changed" : "session_cancelled",
        key,
        phone,
        message,
        phone ? "pending" : "skipped",
        phone ? null : "Nomor HP tidak valid",
        sessionId,
      ]
    );
    if (row) queued += 1;
  }
  return { queued, late };
}

/**
 * Sesi Personal Training dipindah coach/admin (T-067-A7): catat di sesi (laporan
 * perubahan + tanda terlambat) dan antrekan WA ke member. Kabar reschedule
 * sebelumnya yang belum terkirim dilewati supaya member hanya menerima jadwal terbaru.
 */
export async function queueRescheduleNotice(
  input: { sessionId: string; branchId: string; customerId: string; rescheduleId: string; phone: string | null; message: string; start: Date },
  now = new Date()
): Promise<{ queued: boolean; late: boolean }> {
  const settings = await loadCoachLeaveSettings(input.branchId);
  const late = isChangeNoticeLate(input.start, now, settings.member_notice_min_hours);
  await query(
    `UPDATE studio.class_sessions SET changed_at = now(), change_kind = 'rescheduled', change_notice_late = $2 WHERE id = $1`,
    [input.sessionId, late]
  );
  await query(
    `UPDATE studio.member_notifications SET status = 'skipped', error = 'Digantikan jadwal terbaru'
     WHERE session_id = $1 AND kind = 'session_rescheduled' AND status = 'pending'`,
    [input.sessionId]
  );
  const phone = input.phone ? normalizeMemberPhone(input.phone) : null;
  const row = await queryOne<{ id: string }>(
    `INSERT INTO studio.member_notifications (branch_id, customer_id, kind, dedup_key, phone, message, status, error, session_id)
     VALUES ($1, $2, 'session_rescheduled', $3, $4, $5, $6, $7, $8) ON CONFLICT (dedup_key) DO NOTHING RETURNING id`,
    [
      input.branchId,
      input.customerId,
      `pt_reschedule:${input.rescheduleId}`,
      phone,
      input.message,
      phone ? "pending" : "skipped",
      phone ? null : "Nomor HP tidak valid",
      input.sessionId,
    ]
  );
  return { queued: Boolean(row), late };
}

/**
 * Kirim kabar perubahan yang masih pending dan boleh dikirim sekarang (jam
 * layak, atau kelas terlalu dekat untuk menunggu pagi). Kelas yang sudah
 * lewat → skipped. sessionId membatasi ke satu sesi (dipanggil sesudah queue).
 */
export async function flushChangeNotices(now = new Date(), sessionId?: string): Promise<{ sent: number; failed: number; held: number }> {
  const rows = await query<{ id: string; phone: string; message: string; session_date: string; start_time: string }>(
    `SELECT n.id, n.phone, n.message, s.session_date::text AS session_date, to_char(s.start_time,'HH24:MI') AS start_time
     FROM studio.member_notifications n JOIN studio.class_sessions s ON s.id = n.session_id
     WHERE n.status = 'pending' AND n.kind = ANY($1::varchar[]) AND ($2::uuid IS NULL OR n.session_id = $2)
     ORDER BY n.created_at
     LIMIT 200`,
    [CHANGE_KINDS, sessionId ?? null]
  );
  const out = { sent: 0, failed: 0, held: 0 };
  for (const r of rows) {
    const start = sessionStartAt(r.session_date, r.start_time);
    if (start.getTime() <= now.getTime()) {
      await query(`UPDATE studio.member_notifications SET status = 'skipped', error = 'Kelas sudah mulai' WHERE id = $1 AND status = 'pending'`, [r.id]);
      continue;
    }
    if (!canSendChangeNow(now, start)) {
      out.held += 1;
      continue;
    }
    // Klaim dulu supaya flush paralel (watcher + route) tidak mengirim dua kali.
    const claimed = await query(`UPDATE studio.member_notifications SET status = 'failed', error = 'Sedang dikirim' WHERE id = $1 AND status = 'pending' RETURNING id`, [r.id]);
    if (claimed.length === 0) continue;
    const res = await sendWhatsAppText({ target: r.phone, message: r.message }, { messageType: "notification" });
    if (res.success) out.sent += 1;
    else out.failed += 1;
    await query(
      `UPDATE studio.member_notifications SET status = $2::varchar, error = $3, sent_at = CASE WHEN $2::varchar = 'sent' THEN now() END WHERE id = $1`,
      [r.id, res.success ? "sent" : "failed", res.success ? null : res.timedOut ? "Status kirim tidak pasti (timeout) — tidak dikirim ulang" : (res.reason ?? "Gagal kirim")]
    );
  }
  return out;
}

/** Fire-and-forget sesudah aksi staf. */
export function flushChangeNoticesSoon(sessionId: string): void {
  flushChangeNotices(new Date(), sessionId).catch((err) => console.error("[session-change] kirim WA member gagal:", err));
}

export interface SessionChangeReportRow {
  session_id: string;
  session_date: string;
  start_time: string;
  program_name: string;
  change_kind: SessionChangeKind;
  changed_at: string;
  change_notice_late: boolean;
  coach_name: string | null;
  original_coach_name: string | null;
  sent: number;
  pending: number;
  failed: number;
  skipped: number;
}

/** Laporan Program Director: perubahan jadwal yang dikabarkan ke member (sesi 14 hari terakhir & mendatang). */
export async function listSessionChanges(branchId: string): Promise<SessionChangeReportRow[]> {
  return query<SessionChangeReportRow>(
    `SELECT s.id AS session_id, s.session_date::text AS session_date, to_char(s.start_time,'HH24:MI') AS start_time,
            p.name AS program_name, s.change_kind, s.changed_at, s.change_notice_late,
            COALESCE(c.display_name, c.full_name) AS coach_name, COALESCE(oc.display_name, oc.full_name) AS original_coach_name,
            COUNT(n.id) FILTER (WHERE n.status = 'sent')::int AS sent,
            COUNT(n.id) FILTER (WHERE n.status = 'pending')::int AS pending,
            COUNT(n.id) FILTER (WHERE n.status = 'failed')::int AS failed,
            COUNT(n.id) FILTER (WHERE n.status = 'skipped')::int AS skipped
     FROM studio.class_sessions s
     JOIN studio.programs p ON p.id = s.program_id
     LEFT JOIN studio.coaches c ON c.id = s.coach_id
     LEFT JOIN studio.coaches oc ON oc.id = s.original_coach_id
     LEFT JOIN studio.member_notifications n ON n.session_id = s.id
       AND n.kind = CASE s.change_kind WHEN 'coach_changed' THEN 'session_coach_changed' WHEN 'rescheduled' THEN 'session_rescheduled' ELSE 'session_cancelled' END
     WHERE s.branch_id = $1 AND s.changed_at IS NOT NULL
       AND s.session_date >= (now() AT TIME ZONE 'Asia/Jakarta')::date - 14
     GROUP BY s.id, p.name, c.display_name, c.full_name, oc.display_name, oc.full_name
     ORDER BY s.session_date DESC, s.start_time DESC
     LIMIT 100`,
    [branchId]
  );
}
