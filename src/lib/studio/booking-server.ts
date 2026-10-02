import type { PoolClient } from "pg";
import { ApiError } from "@/lib/api/auth";
import { postJournalFromMapping } from "@/lib/accounting/journal-mapping-posting";
import { query, queryOne, withTransaction } from "@/lib/db";
import {
  checkBookingWindow,
  checkCheckinWindow,
  classifyCancel,
  DEFAULT_SETTINGS,
  pickPass,
  RECOGNIZE_STATUSES,
  sessionEpoch,
  type BookingStatus,
  type StudioSettings,
} from "@/lib/studio/booking";
import { redeemValue } from "@/lib/studio/pass";
import { PASS_SELECT, PASS_USAGE_JOIN, type PassRow } from "@/lib/studio/pass-server";

/**
 * Mesin booking kelas (EPIC-054). Semua mutasi berjalan dalam transaksi dengan
 * kunci baris sesi (FOR UPDATE) supaya dua orang tidak mengambil kursi terakhir
 * bersamaan, dan kunci baris pass supaya satu kredit tidak terpakai dua kali.
 */

export interface BookingActor {
  companyId: string;
  branchId: string;
  /** User backoffice; null untuk aksi member dari Member App. */
  actorId: string | null;
  /** Staf boleh walk-in setelah kelas mulai & melewati jendela booking. */
  staff: boolean;
}

// ── Pengaturan ─────────────────────────────────────────────────────────────

export async function loadSettings(branchId: string): Promise<StudioSettings> {
  const rows = await query<{ key: string; value: unknown }>(`SELECT key, value FROM studio.settings WHERE branch_id = $1`, [branchId]);
  const out: StudioSettings = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    if (r.key in out) (out as unknown as Record<string, unknown>)[r.key] = r.value;
  }
  return out;
}

export async function saveSettings(branchId: string, patch: Partial<StudioSettings>, userId: string) {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    await query(
      `INSERT INTO studio.settings (branch_id, key, value, updated_by) VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (branch_id, key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [branchId, key, JSON.stringify(value), userId]
    );
  }
  return loadSettings(branchId);
}

// ── Helper transaksi ───────────────────────────────────────────────────────

interface LockedSession {
  id: string;
  session_date: string;
  start_time: string;
  end_time: string;
  capacity: number;
  status: string;
  program_kind: string;
  program_name: string;
}

async function lockSession(client: PoolClient, branchId: string, sessionId: string): Promise<LockedSession> {
  const { rows } = await client.query(
    `SELECT s.id, s.session_date::text AS session_date, to_char(s.start_time,'HH24:MI') AS start_time,
            to_char(s.end_time,'HH24:MI') AS end_time, s.capacity, s.status, p.kind AS program_kind, p.name AS program_name
     FROM studio.class_sessions s JOIN studio.programs p ON p.id = s.program_id
     WHERE s.id = $1 AND s.branch_id = $2
     FOR UPDATE OF s`,
    [sessionId, branchId]
  );
  if (!rows[0]) throw ApiError.notFound("Kelas tidak ditemukan");
  return rows[0] as LockedSession;
}

async function seatsTakenTx(client: PoolClient, sessionId: string): Promise<number> {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS c FROM studio.bookings WHERE session_id = $1 AND status IN ('booked','attended')`,
    [sessionId]
  );
  return rows[0].c as number;
}

/** Pass member yang berlaku di tanggal sesi + saldo, dikunci untuk dipakai. */
async function lockMemberPasses(client: PoolClient, branchId: string, customerId: string): Promise<(PassRow & { class_left: number; pt_left: number })[]> {
  await client.query(
    `SELECT id FROM studio.member_passes WHERE branch_id = $1 AND customer_id = $2 AND status IN ('active','exhausted') FOR UPDATE`,
    [branchId, customerId]
  );
  const { rows } = await client.query(
    `SELECT ${PASS_SELECT}
     FROM studio.member_passes mp
     JOIN pos.pos_customers c ON c.id = mp.customer_id
     ${PASS_USAGE_JOIN}
     WHERE mp.branch_id = $1 AND mp.customer_id = $2 AND mp.status IN ('active','exhausted')`,
    [branchId, customerId]
  );
  return (rows as PassRow[]).map((p) => ({
    ...p,
    class_left: Math.max(p.class_credits_total - p.class_used, 0),
    pt_left: Math.max(p.pt_credits_total - p.pt_used, 0),
  }));
}

async function refreshPassStatus(client: PoolClient, passId: string) {
  // Kredit habis & tanpa facility → exhausted; ada kredit lagi → active.
  await client.query(
    `UPDATE studio.member_passes mp SET status = CASE
        WHEN (mp.class_credits_total - COALESCE(u.class_used,0)) <= 0
         AND (mp.pt_credits_total - COALESCE(u.pt_used,0)) <= 0
         AND NOT mp.facility_access THEN 'exhausted' ELSE 'active' END,
       updated_at = now()
     FROM (SELECT
             -SUM(qty) FILTER (WHERE credit_type='class' AND entry_type IN ('redeem','unredeem','adjust')) AS class_used,
             -SUM(qty) FILTER (WHERE credit_type='pt' AND entry_type IN ('redeem','unredeem','adjust')) AS pt_used
           FROM studio.pass_credit_ledger WHERE pass_id = $1) u
     WHERE mp.id = $1 AND mp.status IN ('active','exhausted')`,
    [passId]
  );
}

/** Kunci 1 kredit kelas untuk booking (ledger redeem qty −1, nilai diakui nanti). */
async function holdCredit(client: PoolClient, actor: BookingActor, passId: string, sessionId: string, bookingId: string, note: string) {
  const { rows } = await client.query(
    `INSERT INTO studio.pass_credit_ledger (company_id, branch_id, pass_id, entry_type, credit_type, qty, amount, session_id, booking_id, note, created_by)
     VALUES ($1,$2,$3,'redeem','class',-1,0,$4,$5,$6,$7) RETURNING id`,
    [actor.companyId, actor.branchId, passId, sessionId, bookingId, note, actor.actorId]
  );
  await client.query(`UPDATE studio.bookings SET ledger_id = $2, pass_id = $3 WHERE id = $1`, [bookingId, rows[0].id, passId]);
  await refreshPassStatus(client, passId);
}

async function releaseCredit(client: PoolClient, actor: BookingActor, booking: { id: string; pass_id: string | null; ledger_id: string | null; session_id: string }, note: string) {
  if (!booking.ledger_id || !booking.pass_id) return;
  await client.query(
    `INSERT INTO studio.pass_credit_ledger (company_id, branch_id, pass_id, entry_type, credit_type, qty, amount, session_id, booking_id, note, created_by)
     VALUES ($1,$2,$3,'unredeem','class',1,0,$4,$5,$6,$7)`,
    [actor.companyId, actor.branchId, booking.pass_id, booking.session_id, booking.id, note, actor.actorId]
  );
  await client.query(`UPDATE studio.bookings SET ledger_id = NULL WHERE id = $1`, [booking.id]);
  await refreshPassStatus(client, booking.pass_id);
}

/** Naikkan waitlist selama ada kursi; member tanpa kredit dilewati (tetap waitlist). */
async function promoteWaitlist(client: PoolClient, actor: BookingActor, session: LockedSession): Promise<string[]> {
  const promoted: string[] = [];
  let free = session.capacity - (await seatsTakenTx(client, session.id));
  if (free <= 0) return promoted;
  const { rows } = await client.query(
    `SELECT id, customer_id FROM studio.bookings WHERE session_id = $1 AND status = 'waitlisted'
     ORDER BY COALESCE(waitlisted_at, booked_at) FOR UPDATE`,
    [session.id]
  );
  for (const w of rows as { id: string; customer_id: string }[]) {
    if (free <= 0) break;
    const passes = await lockMemberPasses(client, actor.branchId, w.customer_id);
    const pass = pickPass(passes.map((p) => ({ ...p, breakage_recognized: Boolean(p.breakage_recognized_at) })), session.session_date);
    if (!pass) continue;
    await client.query(`UPDATE studio.bookings SET status = 'booked', promoted_at = now(), updated_at = now() WHERE id = $1`, [w.id]);
    await holdCredit(client, actor, pass.id, session.id, w.id, `Naik dari waitlist · ${session.program_name}`);
    promoted.push(w.id);
    free--;
  }
  return promoted;
}

// ── Operasi publik ─────────────────────────────────────────────────────────

export interface CreateBookingResult {
  id: string;
  status: BookingStatus;
  pass_code: string | null;
  class_left: number | null;
}

export async function createBooking(
  actor: BookingActor,
  input: { session_id: string; customer_id: string; source: "front_desk" | "member_app" | "walk_in"; check_in?: boolean; notes?: string | null }
): Promise<CreateBookingResult> {
  const settings = await loadSettings(actor.branchId);
  return withTransaction(async (client) => {
    const session = await lockSession(client, actor.branchId, input.session_id);
    if (session.program_kind !== "class") throw ApiError.badRequest("Booking personal training lewat menu PT (EPIC-055)");
    const win = checkBookingWindow(session, Date.now(), settings, actor.staff);
    if (!win.ok) throw ApiError.conflict(win.reason);

    const dup = await client.query(
      `SELECT status FROM studio.bookings WHERE session_id = $1 AND customer_id = $2 AND status IN ('booked','waitlisted','attended')`,
      [session.id, input.customer_id]
    );
    if (dup.rowCount) throw ApiError.conflict(`Sudah ${dup.rows[0].status === "waitlisted" ? "masuk waitlist" : "terdaftar"} di kelas ini`);

    if (!actor.staff && settings.max_active_bookings > 0) {
      const { rows } = await client.query(
        `SELECT COUNT(*)::int AS c FROM studio.bookings b JOIN studio.class_sessions s ON s.id = b.session_id
         WHERE b.customer_id = $1 AND b.status = 'booked' AND s.session_date >= (now() AT TIME ZONE 'Asia/Jakarta')::date`,
        [input.customer_id]
      );
      if (rows[0].c >= settings.max_active_bookings) throw ApiError.conflict(`Maksimal ${settings.max_active_bookings} booking aktif`);
    }

    // Tabrakan jadwal member sendiri (dua kelas di jam yang sama).
    const clash = await client.query(
      `SELECT p.name FROM studio.bookings b
       JOIN studio.class_sessions s ON s.id = b.session_id JOIN studio.programs p ON p.id = s.program_id
       WHERE b.customer_id = $1 AND b.status IN ('booked','attended') AND s.session_date = $2::date
         AND s.start_time < $4::time AND s.end_time > $3::time`,
      [input.customer_id, session.session_date, session.start_time, session.end_time]
    );
    if (clash.rowCount) throw ApiError.conflict(`Sudah ada booking ${clash.rows[0].name} di jam yang sama`);

    const passes = await lockMemberPasses(client, actor.branchId, input.customer_id);
    const pass = pickPass(passes.map((p) => ({ ...p, breakage_recognized: Boolean(p.breakage_recognized_at) })), session.session_date);
    const full = (await seatsTakenTx(client, session.id)) >= session.capacity;

    if (full) {
      if (!settings.waitlist_enabled) throw ApiError.conflict("Kelas penuh");
      if (!pass) throw ApiError.conflict("Kelas penuh, dan belum ada pass dengan kredit kelas untuk tanggal ini");
      const { rows } = await client.query(
        `INSERT INTO studio.bookings (company_id, branch_id, session_id, customer_id, status, source, waitlisted_at, notes, created_by)
         VALUES ($1,$2,$3,$4,'waitlisted',$5,now(),$6,$7) RETURNING id`,
        [actor.companyId, actor.branchId, session.id, input.customer_id, input.source, input.notes ?? null, actor.actorId]
      );
      return { id: rows[0].id, status: "waitlisted" as BookingStatus, pass_code: pass.pass_code, class_left: pass.class_left };
    }

    if (!pass) throw ApiError.conflict("Belum ada pass dengan kredit kelas yang berlaku di tanggal ini");
    const status: BookingStatus = input.check_in ? "attended" : "booked";
    const { rows } = await client.query(
      `INSERT INTO studio.bookings (company_id, branch_id, session_id, customer_id, status, source, checked_in_at, checked_in_by, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [
        actor.companyId, actor.branchId, session.id, input.customer_id, status, input.source,
        input.check_in ? new Date() : null, input.check_in ? actor.actorId : null, input.notes ?? null, actor.actorId,
      ]
    );
    await holdCredit(client, actor, pass.id, session.id, rows[0].id, `Booking ${session.program_name} ${session.session_date} ${session.start_time}`);
    return { id: rows[0].id, status, pass_code: pass.pass_code, class_left: pass.class_left - 1 };
  });
}

interface BookingLockRow {
  id: string;
  session_id: string;
  customer_id: string;
  pass_id: string | null;
  ledger_id: string | null;
  status: BookingStatus;
}

async function lockBooking(client: PoolClient, branchId: string, bookingId: string): Promise<BookingLockRow> {
  const { rows } = await client.query(
    `SELECT id, session_id, customer_id, pass_id, ledger_id, status FROM studio.bookings WHERE id = $1 AND branch_id = $2 FOR UPDATE`,
    [bookingId, branchId]
  );
  if (!rows[0]) throw ApiError.notFound("Booking tidak ditemukan");
  return rows[0] as BookingLockRow;
}

/**
 * Batalkan booking. Tepat waktu → kredit kembali; terlambat → late_cancelled
 * (kredit hangus, diakui saat kelas selesai). Staf boleh memaksa kredit kembali
 * (`waive`) mis. untuk kasus khusus. Kursi kosong langsung diisi waitlist.
 */
export async function cancelBooking(
  actor: BookingActor,
  bookingId: string,
  opts: { reason?: string | null; waive?: boolean; customerId?: string }
): Promise<{ status: BookingStatus; refunded: boolean; promoted: number }> {
  const settings = await loadSettings(actor.branchId);
  return withTransaction(async (client) => {
    const b = await lockBooking(client, actor.branchId, bookingId);
    if (opts.customerId && b.customer_id !== opts.customerId) throw ApiError.notFound("Booking tidak ditemukan");
    const session = await lockSession(client, actor.branchId, b.session_id);
    if (session.status === "completed") throw ApiError.conflict("Kelas sudah diselesaikan");
    if (!["booked", "waitlisted"].includes(b.status)) throw ApiError.conflict("Booking ini tidak bisa dibatalkan");

    if (b.status === "waitlisted") {
      await client.query(
        `UPDATE studio.bookings SET status = 'cancelled', cancelled_at = now(), cancel_reason = $2, updated_at = now() WHERE id = $1`,
        [b.id, opts.reason ?? null]
      );
      return { status: "cancelled" as BookingStatus, refunded: false, promoted: 0 };
    }

    const timing = classifyCancel(Date.now(), sessionEpoch(session.session_date, session.start_time), settings.cancel_window_hours);
    const refund = timing === "in_time" || (actor.staff && Boolean(opts.waive));
    const status: BookingStatus = refund ? "cancelled" : "late_cancelled";
    await client.query(
      `UPDATE studio.bookings SET status = $2, cancelled_at = now(), cancel_reason = $3, updated_at = now() WHERE id = $1`,
      [b.id, status, opts.reason ?? null]
    );
    if (refund) await releaseCredit(client, actor, b, refund && timing === "late" ? "Batal (dikecualikan staf)" : "Batal tepat waktu");
    const promoted = await promoteWaitlist(client, actor, session);
    return { status, refunded: refund, promoted: promoted.length };
  });
}

export async function checkInBooking(actor: BookingActor, bookingId: string, override = false): Promise<void> {
  const settings = await loadSettings(actor.branchId);
  await withTransaction(async (client) => {
    const b = await lockBooking(client, actor.branchId, bookingId);
    const session = await lockSession(client, actor.branchId, b.session_id);
    if (session.status !== "scheduled") throw ApiError.conflict("Kelas sudah selesai/dibatalkan");
    if (b.status === "attended") return;
    if (b.status !== "booked") throw ApiError.conflict("Hanya booking terdaftar yang bisa check-in");
    if (!override) {
      const win = checkCheckinWindow(session, Date.now(), settings);
      if (!win.ok) throw ApiError.conflict(win.reason);
    }
    await client.query(
      `UPDATE studio.bookings SET status = 'attended', checked_in_at = now(), checked_in_by = $2, updated_at = now() WHERE id = $1`,
      [b.id, actor.actorId]
    );
  });
}

/** Batalkan check-in (salah klik) — kembali ke terdaftar selama kelas belum diselesaikan. */
export async function undoCheckIn(actor: BookingActor, bookingId: string): Promise<void> {
  await withTransaction(async (client) => {
    const b = await lockBooking(client, actor.branchId, bookingId);
    const session = await lockSession(client, actor.branchId, b.session_id);
    if (session.status !== "scheduled") throw ApiError.conflict("Kelas sudah diselesaikan");
    if (b.status !== "attended") throw ApiError.conflict("Booking belum check-in");
    await client.query(`UPDATE studio.bookings SET status = 'booked', checked_in_at = NULL, checked_in_by = NULL, updated_at = now() WHERE id = $1`, [b.id]);
  });
}

/**
 * Selesaikan kelas: booking yang tidak check-in → no_show; kredit booking hadir,
 * no-show, dan batal telat diakui sebagai revenue (alokasi kumulatif per pass),
 * lalu satu jurnal STUDIO_PASS_REDEEM_CLASS per sesi. Idempoten.
 */
export async function completeSession(actor: BookingActor, sessionId: string): Promise<{ recognized: number; attended: number; no_show: number; late: number }> {
  const res = await withTransaction(async (client) => {
    const session = await lockSession(client, actor.branchId, sessionId);
    if (session.status === "cancelled") throw ApiError.conflict("Kelas dibatalkan");
    await client.query(
      `UPDATE studio.bookings SET status = 'no_show', updated_at = now() WHERE session_id = $1 AND status = 'booked'`,
      [sessionId]
    );
    await client.query(
      `UPDATE studio.bookings SET status = 'cancelled', cancel_reason = COALESCE(cancel_reason, 'Kelas selesai — waitlist tidak naik'),
              cancelled_at = now(), updated_at = now()
       WHERE session_id = $1 AND status = 'waitlisted'`,
      [sessionId]
    );
    const { rows: toRecognize } = await client.query(
      `SELECT b.id, b.status, b.pass_id, b.ledger_id
       FROM studio.bookings b JOIN studio.pass_credit_ledger l ON l.id = b.ledger_id
       WHERE b.session_id = $1 AND b.status = ANY($2) AND l.recognized_at IS NULL
       ORDER BY b.booked_at`,
      [sessionId, RECOGNIZE_STATUSES]
    );
    let total = 0;
    for (const r of toRecognize as { id: string; status: BookingStatus; pass_id: string; ledger_id: string }[]) {
      const { rows } = await client.query(
        `SELECT mp.class_value::float8 AS class_value, mp.class_credits_total,
                (SELECT COUNT(*)::int FROM studio.pass_credit_ledger l
                  WHERE l.pass_id = mp.id AND l.credit_type = 'class' AND l.entry_type = 'redeem' AND l.recognized_at IS NOT NULL) AS recognized_count
         FROM studio.member_passes mp WHERE mp.id = $1 FOR UPDATE`,
        [r.pass_id]
      );
      const p = rows[0] as { class_value: number; class_credits_total: number; recognized_count: number };
      const amount = redeemValue(p.class_value, p.class_credits_total, p.recognized_count);
      await client.query(`UPDATE studio.pass_credit_ledger SET amount = $2, recognized_at = now() WHERE id = $1`, [r.ledger_id, amount]);
      await client.query(`UPDATE studio.bookings SET recognized_at = now() WHERE id = $1`, [r.id]);
      total += amount;
    }
    await client.query(`UPDATE studio.class_sessions SET status = 'completed', completed_at = COALESCE(completed_at, now()), updated_at = now() WHERE id = $1`, [sessionId]);
    const { rows: counts } = await client.query(
      `SELECT COUNT(*) FILTER (WHERE status='attended')::int AS attended, COUNT(*) FILTER (WHERE status='no_show')::int AS no_show,
              COUNT(*) FILTER (WHERE status='late_cancelled')::int AS late
       FROM studio.bookings WHERE session_id = $1`,
      [sessionId]
    );
    return { recognized: Math.round(total * 100) / 100, session, ...counts[0] } as {
      recognized: number; session: LockedSession; attended: number; no_show: number; late: number;
    };
  });

  if (res.recognized > 0 && actor.actorId) {
    try {
      const posted = await postJournalFromMapping({
        companyId: actor.companyId,
        userId: actor.actorId,
        eventCode: "STUDIO_PASS_REDEEM_CLASS",
        documentType: "STUDIO_SESSION",
        documentId: sessionId,
        entryDate: res.session.session_date,
        amounts: { TOTAL: res.recognized, SUBTOTAL: res.recognized, PAID: res.recognized },
        description: `Revenue kelas ${res.session.program_name} ${res.session.session_date} ${res.session.start_time}`,
        sourceModule: "STUDIO",
      });
      if (posted.entryId) await query(`UPDATE studio.class_sessions SET journal_entry_id = $2 WHERE id = $1`, [sessionId, posted.entryId]);
    } catch (error) {
      console.error("[studio] jurnal redeem kelas gagal (non-blocking):", error);
    }
  }
  return { recognized: res.recognized, attended: res.attended, no_show: res.no_show, late: res.late };
}

/** Selesaikan otomatis kelas yang sudah lewat ≥ 1 jam dari jam selesai. */
export async function completePastSessions(actor: BookingActor): Promise<number> {
  const rows = await query<{ id: string }>(
    `SELECT id FROM studio.class_sessions
     WHERE branch_id = $1 AND status = 'scheduled'
       AND (session_date + end_time) < (now() AT TIME ZONE 'Asia/Jakarta') - interval '1 hour'
     ORDER BY session_date, start_time LIMIT 200`,
    [actor.branchId]
  );
  for (const r of rows) await completeSession(actor, r.id);
  return rows.length;
}

/**
 * Kelas dibatalkan admin → semua booking batal dengan kredit kembali
 * (bukan salah member). Dipanggil dari PATCH sesi.
 */
export async function releaseSessionBookings(actor: BookingActor, sessionId: string, reason: string): Promise<number> {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, session_id, customer_id, pass_id, ledger_id, status FROM studio.bookings
       WHERE session_id = $1 AND status IN ('booked','waitlisted','attended','late_cancelled') FOR UPDATE`,
      [sessionId]
    );
    for (const b of rows as BookingLockRow[]) {
      await client.query(
        `UPDATE studio.bookings SET status = 'cancelled', cancelled_at = now(), cancel_reason = $2, updated_at = now() WHERE id = $1`,
        [b.id, `Kelas dibatalkan: ${reason}`]
      );
      await releaseCredit(client, actor, b, `Kelas dibatalkan: ${reason}`);
    }
    return rows.length;
  });
}

/** Roster satu sesi (urut: hadir/terdaftar dulu, waitlist sesuai antrean). */
export async function loadRoster(branchId: string, sessionId: string) {
  return query(
    `SELECT b.id, b.status, b.source, b.booked_at, b.waitlisted_at, b.checked_in_at, b.cancelled_at, b.cancel_reason, b.notes,
            b.customer_id, c.name AS member_name, c.phone AS member_phone, c.photo_url,
            mp.pass_code, mp.product_name,
            GREATEST(mp.class_credits_total - COALESCE(u.class_used, 0), 0)::int AS class_left
     FROM studio.bookings b
     JOIN pos.pos_customers c ON c.id = b.customer_id
     LEFT JOIN studio.member_passes mp ON mp.id = b.pass_id
     LEFT JOIN LATERAL (
       SELECT -SUM(l.qty) FILTER (WHERE l.credit_type='class' AND l.entry_type IN ('redeem','unredeem','adjust')) AS class_used
       FROM studio.pass_credit_ledger l WHERE l.pass_id = mp.id
     ) u ON true
     WHERE b.session_id = $1 AND b.branch_id = $2
     ORDER BY CASE b.status WHEN 'attended' THEN 0 WHEN 'booked' THEN 1 WHEN 'waitlisted' THEN 2 WHEN 'no_show' THEN 3 ELSE 4 END,
              COALESCE(b.waitlisted_at, b.booked_at)`,
    [sessionId, branchId]
  );
}

export async function findCustomerByCode(code: string): Promise<{ id: string; name: string | null; phone: string } | null> {
  const raw = code.trim();
  if (/^NH-/i.test(raw)) {
    return queryOne(
      `SELECT c.id, c.name, c.phone FROM studio.member_passes mp JOIN pos.pos_customers c ON c.id = mp.customer_id
       WHERE upper(mp.pass_code) = upper($1) LIMIT 1`,
      [raw]
    );
  }
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8) return null;
  const normalized = digits.startsWith("0") ? `62${digits.slice(1)}` : digits.startsWith("8") ? `62${digits}` : digits;
  return queryOne(
    `SELECT id, name, phone FROM pos.pos_customers WHERE regexp_replace(phone, '\\D', '', 'g') = $1 LIMIT 1`,
    [normalized]
  );
}
