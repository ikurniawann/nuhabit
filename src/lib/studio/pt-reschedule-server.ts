import { ApiError } from "@/lib/api/auth";
import { query, queryOne, withTransaction } from "@/lib/db";
import { sessionEpoch } from "@/lib/studio/booking";
import { loadSettings, type BookingActor } from "@/lib/studio/booking-server";
import { dedupKey } from "@/lib/studio/jobs";
import { applyBookingBenefits } from "@/lib/studio/loyalty";
import { memberBenefits } from "@/lib/studio/loyalty-server";
import { loadPtSlots } from "@/lib/studio/pt-server";
import {
  checkReschedule,
  coachRescheduledMessage,
  memberRescheduledMessage,
  type RescheduleActor,
} from "@/lib/studio/pt-reschedule";
import { flushChangeNoticesSoon, queueRescheduleNotice } from "@/lib/studio/session-change-server";
import { toMinutes } from "@/lib/studio/schedule";
import { sendStaffWa } from "@/lib/studio/staff-wa";

/**
 * Reschedule sesi Personal Training (EPIC-067 T-067-A7). Sesi dipindah di
 * tempat — booking, kredit pass, check-in & komisi tetap menempel ke sesi yang
 * sama. Member & coach hanya mengubah tanggal/jam; admin juga boleh mengganti
 * coach. WA ke pihak lain sesudah commit.
 */

const memberAppUrl = () => `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/member`;
const portalUrl = () => `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/coach`;

interface PtBookingRow {
  booking_id: string;
  booking_status: string;
  booked_at: string;
  customer_id: string;
  member_name: string | null;
  member_phone: string | null;
  pass_id: string | null;
  pass_valid_from: string | null;
  pass_valid_until: string | null;
  session_id: string;
  session_status: string;
  origin: string;
  session_date: string;
  start_time: string;
  program_id: string;
  program_name: string;
  program_kind: string;
  duration_minutes: number;
  coach_id: string | null;
}

const BOOKING_SQL = `
  SELECT b.id AS booking_id, b.status AS booking_status, b.booked_at, b.customer_id, cu.name AS member_name, cu.phone AS member_phone,
         b.pass_id, mp.valid_from::text AS pass_valid_from, mp.valid_until::text AS pass_valid_until,
         s.id AS session_id, s.status AS session_status, s.origin, s.session_date::text AS session_date,
         to_char(s.start_time,'HH24:MI') AS start_time, s.program_id, p.name AS program_name, p.kind AS program_kind,
         p.duration_minutes, s.coach_id
  FROM studio.bookings b
  JOIN studio.class_sessions s ON s.id = b.session_id
  JOIN studio.programs p ON p.id = s.program_id
  LEFT JOIN pos.pos_customers cu ON cu.id = b.customer_id
  LEFT JOIN studio.member_passes mp ON mp.id = b.pass_id`;

export interface RescheduleInput {
  booking_id: string;
  date: string;
  start_time: string;
  /** Hanya admin: pindah ke coach lain yang melatih program ini. */
  coach_id?: string | null;
  reason?: string | null;
}

export interface RescheduleScope {
  by: RescheduleActor;
  /** member: booking harus milik customer ini. */
  customerId?: string;
  /** coach: sesi harus milik coach ini. */
  coachId?: string;
}

export interface RescheduleResult {
  reschedule_id: string;
  session_id: string;
  from: { date: string; time: string; coach_id: string | null };
  to: { date: string; time: string; end_time: string; coach_id: string };
  member_notified: boolean;
}

export async function reschedulePtBooking(actor: BookingActor, input: RescheduleInput, scope: RescheduleScope): Promise<RescheduleResult> {
  const member = scope.by === "member";
  const pre = await queryOne<PtBookingRow>(`${BOOKING_SQL} WHERE b.id = $1 AND b.branch_id = $2`, [input.booking_id, actor.branchId]);
  const notFound = () => ApiError.notFound(member ? "Booking not found" : "Booking tidak ditemukan");
  if (!pre) throw notFound();
  if (scope.customerId && pre.customer_id !== scope.customerId) throw notFound();
  if (scope.coachId && pre.coach_id !== scope.coachId) throw notFound();
  if (pre.program_kind !== "pt" || pre.origin !== "pt_booking") {
    throw ApiError.badRequest(member ? "Only Personal Training sessions can be rescheduled." : "Hanya sesi Personal Training yang bisa dipindah");
  }
  const targetCoach = scope.by === "staff" && input.coach_id ? input.coach_id : pre.coach_id;
  if (!targetCoach) throw ApiError.badRequest("Sesi belum punya coach — tunjuk coach dulu");

  const settings = applyBookingBenefits(await loadSettings(actor.branchId), await memberBenefits(pre.customer_id));
  const endMinutes = toMinutes(input.start_time) + pre.duration_minutes;
  if (endMinutes > 24 * 60) throw ApiError.badRequest(member ? "That time runs past midnight." : "Jam selesai melewati tengah malam");
  const endTime = `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`;

  const result = await withTransaction(async (client) => {
    // Kunci slot coach tujuan per tanggal (sama dengan booking baru) lalu baris booking & sesi.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`studio-pt:${targetCoach}:${input.date}`]);
    const { rows } = await client.query<PtBookingRow>(`${BOOKING_SQL} WHERE b.id = $1 FOR UPDATE OF b, s`, [input.booking_id]);
    const b = rows[0];
    if (!b || b.session_id !== pre.session_id) throw notFound();
    if (b.booking_status !== "booked" || b.session_status !== "scheduled") {
      throw ApiError.conflict(member ? "This booking can no longer be rescheduled." : "Booking ini sudah tidak bisa dipindah");
    }
    const { rows: cnt } = await client.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM studio.pt_reschedules WHERE booking_id = $1 AND actor_kind = 'member'`,
      [b.booking_id]
    );
    const check = checkReschedule({
      actor: scope.by,
      nowMs: Date.now(),
      from: { date: b.session_date, time: b.start_time },
      to: { date: input.date, time: input.start_time },
      cancelWindowHours: settings.cancel_window_hours,
      memberCount: cnt[0].c,
      memberMax: settings.pt_member_reschedule_max,
    });
    if (!check.ok) throw ApiError.conflict(check.reason);

    if (b.pass_valid_from && b.pass_valid_until && (input.date < b.pass_valid_from || input.date > b.pass_valid_until)) {
      throw ApiError.conflict(
        member
          ? `Your pass is valid until ${b.pass_valid_until}. Pick a date within your pass period.`
          : `Pass member berlaku ${b.pass_valid_from} s/d ${b.pass_valid_until} — pilih tanggal di dalam masa berlaku`
      );
    }

    // Slot harus kosong di jam ketersediaan coach (sesi ini sendiri tidak dihitung sibuk).
    const slotSet = await loadPtSlots(actor.branchId, {
      programId: b.program_id,
      date: input.date,
      coachId: targetCoach,
      staff: !member,
      excludeSessionId: b.session_id,
    });
    if (!slotSet[0]?.slots.includes(input.start_time)) {
      throw ApiError.conflict(member ? "That time is no longer available — please pick another." : "Slot sudah tidak tersedia — pilih jam lain");
    }

    const clash = await client.query(
      `SELECT p.name FROM studio.bookings ob
       JOIN studio.class_sessions s ON s.id = ob.session_id JOIN studio.programs p ON p.id = s.program_id
       WHERE ob.customer_id = $1 AND ob.id <> $2 AND ob.status IN ('booked','attended') AND s.session_date = $3::date
         AND s.start_time < $5::time AND s.end_time > $4::time`,
      [b.customer_id, b.booking_id, input.date, input.start_time, endTime]
    );
    if (clash.rowCount) {
      throw ApiError.conflict(member ? `You already have ${clash.rows[0].name} at that time.` : `Member sudah ada booking ${clash.rows[0].name} di jam yang sama`);
    }

    await client.query(
      `UPDATE studio.class_sessions
       SET session_date = $2, start_time = $3, end_time = $4, coach_id = $5, updated_at = now(),
           studio_rescheduled_at = CASE WHEN $6::boolean THEN now() ELSE studio_rescheduled_at END
       WHERE id = $1`,
      [b.session_id, input.date, input.start_time, endTime, targetCoach, !member]
    );
    const { rows: rr } = await client.query<{ id: string }>(
      `INSERT INTO studio.pt_reschedules (company_id, branch_id, session_id, booking_id, from_date, from_start, from_coach_id,
                                          to_date, to_start, to_coach_id, actor_kind, actor_user_id, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [
        actor.companyId, actor.branchId, b.session_id, b.booking_id, b.session_date, b.start_time, b.coach_id,
        input.date, input.start_time, targetCoach, scope.by, actor.actorId, input.reason?.trim() || null,
      ]
    );
    // Pengingat H-1 untuk jadwal lama mungkin sudah terkirim — buka lagi untuk jadwal baru.
    await client.query(`DELETE FROM studio.member_notifications WHERE dedup_key = $1 AND kind = 'session_reminder'`, [dedupKey.session(b.booking_id)]);
    return { rescheduleId: rr[0].id, b };
  });

  const { b, rescheduleId } = result;
  const from = { date: b.session_date, time: b.start_time };
  const to = { date: input.date, time: input.start_time };
  const coaches = await query<{ id: string; name: string; phone: string | null }>(
    `SELECT c.id, COALESCE(c.display_name, c.full_name) AS name, COALESCE(NULLIF(c.phone, ''), e.phone) AS phone
     FROM studio.coaches c LEFT JOIN hris.employees e ON e.id = c.employee_id WHERE c.id = ANY($1::uuid[])`,
    [[targetCoach, b.coach_id].filter(Boolean)]
  );
  const coachById = (id: string | null) => coaches.find((c) => c.id === id) ?? null;
  const newCoach = coachById(targetCoach);
  const oldCoach = coachById(b.coach_id);

  // Member dikabari bila yang memindah bukan dirinya sendiri.
  let memberNotified = false;
  if (!member) {
    const q = await queueRescheduleNotice({
      sessionId: b.session_id,
      branchId: actor.branchId,
      customerId: b.customer_id,
      rescheduleId,
      phone: b.member_phone,
      message: memberRescheduledMessage({
        name: b.member_name,
        program: b.program_name,
        from,
        to,
        coach: newCoach?.name ?? null,
        reason: input.reason?.trim() || null,
        link: memberAppUrl(),
      }),
      start: new Date(sessionEpoch(to.date, to.time)),
    });
    memberNotified = q.queued;
    flushChangeNoticesSoon(b.session_id);
  }

  // Coach dikabari bila yang memindah bukan coach itu sendiri.
  if (scope.by !== "coach") {
    const base = { member: b.member_name ?? "member", program: b.program_name, from, to, actor: scope.by, reason: input.reason ?? null, portalUrl: portalUrl() };
    const sends: Promise<boolean>[] = [];
    if (oldCoach && newCoach && oldCoach.id !== newCoach.id) {
      sends.push(
        sendStaffWa("pt_reschedule", `pt_reschedule:${rescheduleId}:out`, oldCoach.phone, coachRescheduledMessage({ ...base, coachName: oldCoach.name, role: "outgoing", otherCoach: newCoach.name })),
        sendStaffWa("pt_reschedule", `pt_reschedule:${rescheduleId}:in`, newCoach.phone, coachRescheduledMessage({ ...base, coachName: newCoach.name, role: "incoming" }))
      );
    } else if (newCoach) {
      sends.push(sendStaffWa("pt_reschedule", `pt_reschedule:${rescheduleId}:coach`, newCoach.phone, coachRescheduledMessage({ ...base, coachName: newCoach.name, role: "same" })));
    }
    await Promise.all(sends.map((p) => p.catch((e) => (console.error("[pt-reschedule] WA coach gagal:", e), false))));
  }

  return {
    reschedule_id: rescheduleId,
    session_id: b.session_id,
    from: { ...from, coach_id: b.coach_id },
    to: { ...to, end_time: endTime, coach_id: targetCoach },
    member_notified: memberNotified,
  };
}

export interface RescheduleHistoryRow {
  id: string;
  from_date: string;
  from_start: string;
  to_date: string;
  to_start: string;
  actor_kind: RescheduleActor;
  actor_name: string | null;
  reason: string | null;
  created_at: string;
}

/** Riwayat perpindahan satu booking (terbaru dulu). */
export async function listBookingReschedules(branchId: string, bookingId: string): Promise<RescheduleHistoryRow[]> {
  return query<RescheduleHistoryRow>(
    `SELECT r.id, r.from_date::text AS from_date, to_char(r.from_start,'HH24:MI') AS from_start, r.to_date::text AS to_date,
            to_char(r.to_start,'HH24:MI') AS to_start, r.actor_kind, u.full_name AS actor_name, r.reason, r.created_at
     FROM studio.pt_reschedules r LEFT JOIN configuration.users u ON u.id = r.actor_user_id
     WHERE r.branch_id = $1 AND r.booking_id = $2
     ORDER BY r.created_at DESC`,
    [branchId, bookingId]
  );
}
