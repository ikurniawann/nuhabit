import { ApiError } from "@/lib/api/auth";
import { query, queryOne, withTransaction } from "@/lib/db";
import { DEFAULT_SETTINGS, pickPass, sessionEpoch } from "@/lib/studio/booking";
import { holdCredit, loadSettings, lockMemberPasses, type BookingActor } from "@/lib/studio/booking-server";
import { computeFreeSlots, isOnTimeOff, windowsForDate } from "@/lib/studio/pt";
import { addDays, isValidDate, toMinutes } from "@/lib/studio/schedule";
import { venueToday } from "@/lib/studio/pass-server";

/**
 * Personal Training (EPIC-055): slot kosong coach & booking. Sesi Personal
 * Training dibuat on-demand di studio.class_sessions (origin 'pt_booking',
 * kuota 1) supaya kalender, check-in, revenue & komisi memakai jalur kelas.
 */

export interface PtCoach {
  id: string;
  full_name: string;
  display_name: string | null;
  level: "coach" | "head_coach";
  photo_url: string | null;
  bio: string | null;
  certifications: string | null;
  specialties: string[];
}

/** Program Personal Training aktif + coach yang bisa melatihnya. */
export async function loadPtCatalog(branchId: string, onlyPublic = false) {
  const programs = await query<{ id: string; code: string; name: string; description: string | null; duration_minutes: number; level_label: string | null }>(
    `SELECT id, code, name, description, duration_minutes, level_label FROM studio.programs
     WHERE branch_id = $1 AND kind = 'pt' AND is_active ORDER BY sort_order, name`,
    [branchId]
  );
  const coaches = await query<PtCoach & { program_id: string }>(
    `SELECT cp.program_id, c.id, c.full_name, c.display_name, c.level, c.photo_url, c.bio, c.certifications, c.specialties
     FROM studio.coach_programs cp JOIN studio.coaches c ON c.id = cp.coach_id
     WHERE cp.branch_id = $1 AND c.is_active ${onlyPublic ? "AND c.is_public" : ""}
     ORDER BY CASE c.level WHEN 'head_coach' THEN 0 ELSE 1 END, c.sort_order, c.full_name`,
    [branchId]
  );
  return programs.map((p) => ({
    ...p,
    coaches: coaches.filter((c) => c.program_id === p.id).map(({ program_id: _drop, ...c }) => c),
  }));
}

/**
 * Slot kosong per coach untuk satu program & tanggal. Jendela ketersediaan
 * mingguan − cuti − semua sesi coach yang tidak batal (kelas maupun Personal
 * Training) − jam yang sudah lewat / di luar jendela booking.
 */
export async function loadPtSlots(
  branchId: string,
  opts: { programId: string; date: string; coachId?: string | null; staff: boolean }
): Promise<{ coach: PtCoach; slots: string[] }[]> {
  if (!isValidDate(opts.date)) throw ApiError.badRequest("Tanggal tidak valid");
  const program = await queryOne<{ duration_minutes: number }>(
    `SELECT duration_minutes FROM studio.programs WHERE id = $1 AND branch_id = $2 AND kind = 'pt' AND is_active`,
    [opts.programId, branchId]
  );
  if (!program) throw ApiError.notFound("Program Personal Training tidak ditemukan");

  const today = await venueToday();
  const settings = opts.staff ? DEFAULT_SETTINGS : await loadSettings(branchId);
  if (opts.date < today) return [];
  if (!opts.staff && opts.date > addDays(today, settings.booking_open_days)) return [];

  const catalog = await loadPtCatalog(branchId, !opts.staff);
  const coaches = (catalog.find((p) => p.id === opts.programId)?.coaches ?? []).filter((c) => !opts.coachId || c.id === opts.coachId);
  if (coaches.length === 0) return [];
  const ids = coaches.map((c) => c.id);

  const [windows, busy, timeOff] = await Promise.all([
    query<{ coach_id: string; weekday: number; start_time: string; end_time: string; is_active: boolean }>(
      `SELECT coach_id, weekday, to_char(start_time,'HH24:MI') AS start_time, to_char(end_time,'HH24:MI') AS end_time, is_active
       FROM studio.coach_availability WHERE coach_id = ANY($1)`,
      [ids]
    ),
    query<{ coach_id: string; start_time: string; end_time: string }>(
      `SELECT coach_id, to_char(start_time,'HH24:MI') AS start_time, to_char(end_time,'HH24:MI') AS end_time
       FROM studio.class_sessions WHERE coach_id = ANY($1) AND session_date = $2::date AND status <> 'cancelled'`,
      [ids, opts.date]
    ),
    query<{ coach_id: string; date_from: string; date_to: string }>(
      `SELECT coach_id, date_from::text AS date_from, date_to::text AS date_to FROM studio.coach_time_off
       WHERE coach_id = ANY($1) AND date_from <= $2::date AND date_to >= $2::date`,
      [ids, opts.date]
    ),
  ]);

  // Hari ini: slot mulai minimal sekarang (+ batas tutup booking untuk member).
  let notBefore: number | null = null;
  if (opts.date === today) {
    const now = new Date(Date.now() + 7 * 3_600_000);
    notBefore = now.getUTCHours() * 60 + now.getUTCMinutes() + (opts.staff ? 0 : settings.booking_close_minutes);
  }

  return coaches.map((coach) => {
    if (isOnTimeOff(timeOff.filter((t) => t.coach_id === coach.id), opts.date)) return { coach, slots: [] };
    return {
      coach,
      slots: computeFreeSlots({
        windows: windowsForDate(windows.filter((w) => w.coach_id === coach.id), opts.date),
        busy: busy.filter((b) => b.coach_id === coach.id),
        durationMinutes: program.duration_minutes,
        notBefore,
      }),
    };
  });
}

/**
 * Booking Personal Training: validasi slot masih kosong (dikunci per coach &
 * tanggal dengan advisory lock), pilih pass FEFO dengan kredit Personal
 * Training, buat sesi (kuota 1) + booking + kunci kredit.
 */
export async function createPtBooking(
  actor: BookingActor,
  input: { customer_id: string; program_id: string; coach_id: string; date: string; start_time: string; source: "front_desk" | "member_app"; notes?: string | null }
): Promise<{ booking_id: string; session_id: string; pass_code: string; pt_left: number; end_time: string }> {
  const program = await queryOne<{ duration_minutes: number; name: string }>(
    `SELECT duration_minutes, name FROM studio.programs WHERE id = $1 AND branch_id = $2 AND kind = 'pt' AND is_active`,
    [input.program_id, actor.branchId]
  );
  if (!program) throw ApiError.notFound("Program Personal Training tidak ditemukan");
  const endMinutes = toMinutes(input.start_time) + program.duration_minutes;
  if (endMinutes > 24 * 60) throw ApiError.badRequest("Jam selesai melewati tengah malam");
  const endTime = `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`;
  if (!actor.staff && sessionEpoch(input.date, input.start_time) <= Date.now()) throw ApiError.conflict("Jam tersebut sudah lewat");

  return withTransaction(async (client) => {
    // Serialisasi booking untuk coach + tanggal yang sama (cegah double booking slot).
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`studio-pt:${input.coach_id}:${input.date}`]);

    const slotSet = await loadPtSlots(actor.branchId, { programId: input.program_id, date: input.date, coachId: input.coach_id, staff: actor.staff });
    if (!slotSet[0]?.slots.includes(input.start_time)) {
      throw ApiError.conflict("Slot sudah tidak tersedia — pilih jam lain");
    }

    // Member tidak boleh punya dua jadwal di jam yang sama.
    const clash = await client.query(
      `SELECT p.name FROM studio.bookings b
       JOIN studio.class_sessions s ON s.id = b.session_id JOIN studio.programs p ON p.id = s.program_id
       WHERE b.customer_id = $1 AND b.status IN ('booked','attended') AND s.session_date = $2::date
         AND s.start_time < $4::time AND s.end_time > $3::time`,
      [input.customer_id, input.date, input.start_time, endTime]
    );
    if (clash.rowCount) throw ApiError.conflict(`Sudah ada booking ${clash.rows[0].name} di jam yang sama`);

    const passes = await lockMemberPasses(client, actor.branchId, input.customer_id);
    const pass = pickPass(passes.map((p) => ({ ...p, breakage_recognized: Boolean(p.breakage_recognized_at) })), input.date, "pt");
    if (!pass) throw ApiError.conflict("Belum ada pass dengan kredit Personal Training yang berlaku di tanggal ini");

    const { rows: srows } = await client.query(
      `INSERT INTO studio.class_sessions (company_id, branch_id, session_date, start_time, end_time, program_id, coach_id, capacity, origin, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1,'pt_booking',$8,$9) RETURNING id`,
      [actor.companyId, actor.branchId, input.date, input.start_time, endTime, input.program_id, input.coach_id, input.notes ?? null, actor.actorId]
    );
    const sessionId = srows[0].id as string;
    const { rows: brows } = await client.query(
      `INSERT INTO studio.bookings (company_id, branch_id, session_id, customer_id, status, source, notes, created_by)
       VALUES ($1,$2,$3,$4,'booked',$5,$6,$7) RETURNING id`,
      [actor.companyId, actor.branchId, sessionId, input.customer_id, input.source, input.notes ?? null, actor.actorId]
    );
    await holdCredit(client, actor, pass.id, sessionId, brows[0].id, `Personal Training ${program.name} ${input.date} ${input.start_time}`, "pt");
    return { booking_id: brows[0].id, session_id: sessionId, pass_code: pass.pass_code, pt_left: pass.pt_left - 1, end_time: endTime };
  });
}

// ── Ketersediaan coach ─────────────────────────────────────────────────────

export async function loadAvailability(branchId: string, coachId: string) {
  const coach = await queryOne(`SELECT id FROM studio.coaches WHERE id = $1 AND branch_id = $2`, [coachId, branchId]);
  if (!coach) throw ApiError.notFound("Coach tidak ditemukan");
  const [windows, programs, timeOff] = await Promise.all([
    query(
      `SELECT id, weekday, to_char(start_time,'HH24:MI') AS start_time, to_char(end_time,'HH24:MI') AS end_time, is_active
       FROM studio.coach_availability WHERE coach_id = $1 ORDER BY weekday, start_time`,
      [coachId]
    ),
    query<{ program_id: string }>(`SELECT program_id FROM studio.coach_programs WHERE coach_id = $1`, [coachId]),
    query(
      `SELECT id, date_from::text AS date_from, date_to::text AS date_to, reason FROM studio.coach_time_off
       WHERE coach_id = $1 AND date_to >= (now() AT TIME ZONE 'Asia/Jakarta')::date ORDER BY date_from`,
      [coachId]
    ),
  ]);
  return { windows, program_ids: programs.map((p) => p.program_id), time_off: timeOff };
}

/** Simpan ulang (replace-all) jam ketersediaan mingguan & program Personal Training coach. */
export async function saveAvailability(
  ctx: { companyId: string; branchId: string; userId: string },
  coachId: string,
  input: { windows: { weekday: number; start_time: string; end_time: string }[]; program_ids: string[] }
) {
  for (const w of input.windows) {
    if (toMinutes(w.end_time) <= toMinutes(w.start_time)) throw ApiError.badRequest("Jam selesai harus setelah jam mulai");
  }
  // Tolak jendela yang saling tumpang tindih di hari yang sama (input ganda).
  const byDay = new Map<number, { s: number; e: number }[]>();
  for (const w of input.windows) {
    const list = byDay.get(w.weekday) ?? [];
    const s = toMinutes(w.start_time);
    const e = toMinutes(w.end_time);
    if (list.some((x) => s < x.e && x.s < e)) throw ApiError.badRequest("Ada jam ketersediaan yang tumpang tindih di hari yang sama");
    list.push({ s, e });
    byDay.set(w.weekday, list);
  }
  await withTransaction(async (client) => {
    const coach = await client.query(`SELECT id FROM studio.coaches WHERE id = $1 AND branch_id = $2 FOR UPDATE`, [coachId, ctx.branchId]);
    if (!coach.rowCount) throw ApiError.notFound("Coach tidak ditemukan");
    if (input.program_ids.length) {
      const ok = await client.query(
        `SELECT COUNT(*)::int AS c FROM studio.programs WHERE id = ANY($1) AND branch_id = $2 AND kind = 'pt'`,
        [input.program_ids, ctx.branchId]
      );
      if (ok.rows[0].c !== input.program_ids.length) throw ApiError.badRequest("Program harus program Personal Training");
    }
    await client.query(`DELETE FROM studio.coach_availability WHERE coach_id = $1`, [coachId]);
    for (const w of input.windows) {
      await client.query(
        `INSERT INTO studio.coach_availability (company_id, branch_id, coach_id, weekday, start_time, end_time, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [ctx.companyId, ctx.branchId, coachId, w.weekday, w.start_time, w.end_time, ctx.userId]
      );
    }
    await client.query(`DELETE FROM studio.coach_programs WHERE coach_id = $1`, [coachId]);
    for (const pid of input.program_ids) {
      await client.query(`INSERT INTO studio.coach_programs (coach_id, program_id, branch_id) VALUES ($1,$2,$3)`, [coachId, pid, ctx.branchId]);
    }
  });
}
