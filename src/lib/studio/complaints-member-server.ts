import { ApiError } from "@/lib/api/auth";
import { query, queryOne, withTransaction } from "@/lib/db";
import type { BookingActor } from "@/lib/studio/booking-server";
import {
  type ComplaintCategory,
  type ComplaintKind,
  type ComplaintStatus,
  MEMBER_REPORT_DAILY_LIMIT,
  memberReportPriority,
  memberStatusLabel,
  newMemberReportMessage,
} from "@/lib/studio/complaints";
import { createComplaint } from "@/lib/studio/complaints-server";
import { inSendWindow } from "@/lib/studio/jobs";
import { VENUE_TODAY_SQL } from "@/lib/studio/pass-server";
import { sendStaffWa } from "@/lib/studio/staff-wa";
import { sendOwnerNotification } from "@/lib/wa/notifications-sender";

/**
 * Laporan & masukan dari Member App (EPIC-067 T-067-B4). Member hanya melihat
 * tiket yang ia kirim sendiri (source member_app) dan hanya status ringkas —
 * catatan internal & catatan penyelesaian staf tidak pernah ditampilkan.
 */

const complaintsUrl = () => `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/dashboard/studio/complaints`;

export interface MemberSessionOption {
  id: string;
  program_name: string;
  session_date: string;
  start_time: string;
  coach_name: string | null;
}

/** Sesi yang pernah diikuti member (30 hari terakhir s/d hari ini) — untuk menautkan laporan. */
export async function memberRecentSessions(branchId: string, customerId: string): Promise<MemberSessionOption[]> {
  return query<MemberSessionOption>(
    `SELECT s.id, p.name AS program_name, s.session_date::text AS session_date, to_char(s.start_time,'HH24:MI') AS start_time,
            COALESCE(co.display_name, co.full_name) AS coach_name
     FROM studio.bookings b
     JOIN studio.class_sessions s ON s.id = b.session_id
     JOIN studio.programs p ON p.id = s.program_id
     LEFT JOIN studio.coaches co ON co.id = s.coach_id
     WHERE b.customer_id = $1 AND s.branch_id = $2
       AND b.status IN ('booked','attended','no_show','late_cancelled')
       AND s.status <> 'cancelled'
       AND s.session_date BETWEEN ${VENUE_TODAY_SQL} - 30 AND ${VENUE_TODAY_SQL}
       AND (s.session_date + s.start_time) <= (now() AT TIME ZONE 'Asia/Jakarta')
     ORDER BY s.session_date DESC, s.start_time DESC
     LIMIT 30`,
    [customerId, branchId]
  );
}

export interface MemberReportInput {
  kind: ComplaintKind;
  category: ComplaintCategory;
  message: string;
  session_id?: string | null;
}

export async function createMemberReport(actor: BookingActor, customerId: string, input: MemberReportInput, now = new Date()) {
  const recent = await queryOne<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM studio.complaints
     WHERE customer_id = $1 AND source = 'member_app' AND created_at > $2::timestamptz - interval '24 hours'`,
    [customerId, now.toISOString()]
  );
  if ((recent?.c ?? 0) >= MEMBER_REPORT_DAILY_LIMIT) {
    throw new ApiError(429, "You've sent several reports today. Our team will get back to you — for anything urgent, please contact the front desk.");
  }
  let session: MemberSessionOption | null = null;
  if (input.session_id) {
    session = (await memberRecentSessions(actor.branchId, customerId)).find((s) => s.id === input.session_id) ?? null;
    if (!session) throw ApiError.badRequest("Please pick one of your recent sessions.");
  }
  const member = await queryOne<{ name: string | null; phone: string | null }>(`SELECT name, phone FROM pos.pos_customers WHERE id = $1`, [customerId]);

  const created = await createComplaint(
    actor,
    null,
    {
      source: "member_app",
      kind: input.kind,
      category: input.category,
      priority: memberReportPriority(input.kind, input.category),
      description: input.message,
      customer_id: customerId,
      contact_name: member?.name ?? null,
      contact_phone: member?.phone ?? null,
      session_id: session?.id ?? null,
    },
    now
  );

  // Kabari staf: cedera langsung ke Head Coach/Ops (Notifikasi WA owner, kapan pun); keluhan lain ke PIC
  // default kategori hanya di jam layak — di luar itu cukup lewat batas waktu & eskalasi biasa.
  const t = await queryOne<{ coach: string | null; assignee_user_id: string | null; assignee_phone: string | null }>(
    `SELECT COALESCE(co.display_name, co.full_name) AS coach, k.assignee_user_id,
            (SELECT e.phone FROM hris.employees e WHERE e.user_id = k.assignee_user_id LIMIT 1) AS assignee_phone
     FROM studio.complaints k LEFT JOIN studio.coaches co ON co.id = k.coach_id WHERE k.id = $1`,
    [created.id]
  );
  const message = newMemberReportMessage({
    code: created.code,
    kind: input.kind,
    category: input.category,
    member: member?.name ?? null,
    session: session ? `${session.program_name} ${session.session_date} ${session.start_time}` : null,
    coach: t?.coach ?? null,
    message: input.message,
    url: complaintsUrl(),
  });
  const notified: string[] = [];
  if (input.kind === "complaint" && input.category === "injury") {
    const r = await sendOwnerNotification({ type: "eskalasiKomplain", dedupKey: `complaint:${created.id}:new`, message }).catch(() => ({ sent: false as const }));
    if (r.sent) notified.push("Head Coach/Ops");
  }
  if (input.kind === "complaint" && t?.assignee_user_id && (input.category === "injury" || inSendWindow(now))) {
    if (await sendStaffWa("complaint_new", `complaint:${created.id}:new:pic`, t.assignee_phone, message).catch(() => false)) notified.push("PIC");
  }
  if (notified.length > 0) {
    await query(`INSERT INTO studio.complaint_events (complaint_id, kind, body) VALUES ($1, 'note', $2)`, [created.id, `WA laporan baru ke ${notified.join(" & ")}`]);
  }
  return created;
}

export interface MemberReportRow {
  id: string;
  code: string;
  kind: ComplaintKind;
  category: ComplaintCategory;
  status: ComplaintStatus;
  status_label: string;
  message: string | null;
  session_label: string | null;
  created_at: string;
  resolved_at: string | null;
}

/** Laporan yang dikirim member sendiri (terbaru dulu). */
export async function listMemberReports(branchId: string, customerId: string): Promise<MemberReportRow[]> {
  const rows = await query<Omit<MemberReportRow, "status_label">>(
    `SELECT k.id, k.code, k.kind, k.category, k.status, k.description AS message,
            CASE WHEN s.id IS NULL THEN NULL ELSE p.name || ' · ' || to_char(s.session_date, 'DD Mon') || ' ' || to_char(s.start_time, 'HH24:MI') END AS session_label,
            k.created_at, k.resolved_at
     FROM studio.complaints k
     LEFT JOIN studio.class_sessions s ON s.id = k.session_id
     LEFT JOIN studio.programs p ON p.id = s.program_id
     WHERE k.branch_id = $1 AND k.customer_id = $2 AND k.source = 'member_app'
     ORDER BY k.created_at DESC
     LIMIT 30`,
    [branchId, customerId]
  );
  return rows.map((r) => ({ ...r, status_label: memberStatusLabel(r.status) }));
}

/**
 * Member menjawab tiket yang ditandai selesai: sudah beres → dikonfirmasi;
 * belum → dibuka lagi (Ditangani) dengan komentar member, PIC dikabari WA.
 */
export async function respondToResolution(branchId: string, customerId: string, id: string, input: { resolved: boolean; comment?: string | null }) {
  const comment = input.comment?.trim() || null;
  const reopened = await withTransaction(async (client) => {
    const { rows } = await client.query<{ status: ComplaintStatus; code: string; assignee_user_id: string | null }>(
      `SELECT status, code, assignee_user_id FROM studio.complaints
       WHERE id = $1 AND branch_id = $2 AND customer_id = $3 AND source = 'member_app' FOR UPDATE`,
      [id, branchId, customerId]
    );
    const t = rows[0];
    if (!t) throw ApiError.notFound("Report not found");
    if (t.status !== "resolved") throw ApiError.conflict("This report isn't waiting for your confirmation.");
    const to: ComplaintStatus = input.resolved ? "confirmed" : "in_progress";
    await client.query(
      `UPDATE studio.complaints SET status = $2::varchar,
         confirmed_at = CASE WHEN $2::varchar = 'confirmed' THEN now() ELSE confirmed_at END,
         resolved_at = CASE WHEN $2::varchar = 'in_progress' THEN NULL ELSE resolved_at END,
         updated_at = now()
       WHERE id = $1`,
      [id, to]
    );
    await client.query(
      `INSERT INTO studio.complaint_events (complaint_id, kind, from_status, to_status, body) VALUES ($1, 'status', 'resolved', $2, $3)`,
      [id, to, input.resolved ? `Dikonfirmasi member lewat Member App${comment ? `: ${comment}` : ""}` : `Member: belum selesai${comment ? ` — ${comment}` : ""}`]
    );
    return input.resolved ? null : t;
  });
  if (reopened?.assignee_user_id) {
    const phone = await queryOne<{ phone: string | null }>(`SELECT phone FROM hris.employees WHERE user_id = $1 LIMIT 1`, [reopened.assignee_user_id]);
    await sendStaffWa(
      "complaint_reopened",
      `complaint:${id}:reopen:${Date.now()}`,
      phone?.phone ?? null,
      [`🔁 *Tiket ${reopened.code} dibuka lagi oleh member* — belum selesai menurut member.`, comment ? `"${comment}"` : null, `Tangani di: ${complaintsUrl()}`]
        .filter(Boolean)
        .join("\n")
    ).catch(() => false);
  }
}
