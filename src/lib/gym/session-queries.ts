import "server-only";
/** Baca jadwal: daftar sesi + hitungan kursi, peserta, pratinjau batal, booking, dan log gate. */
import { BOOKING_STATUSES, evaluateCancellation, type BookingStatus, type CreditPolicy, type SessionStatus } from "./booking";
import { branchRules, SEATS_HELD, SESSION_SELECT, type Db, type SessionRow } from "./booking-store";

export interface SessionSummary extends SessionRow {
  confirmed_count: number;
  waitlist_count: number;
  checked_in_count: number;
  seats_left: number;
  my_booking: { id: string; status: BookingStatus; waitlist_position: number | null; promotion_offered_at: string | null } | null;
}

export interface SessionFilter {
  id?: string;
  from?: string | Date;
  to?: string | Date;
  classTypeId?: string;
  coachId?: string;
  branchId?: string;
  statuses?: SessionStatus[];
  /** Sertakan booking aktif member ini di tiap sesi. */
  customerId?: string;
}

export async function listSessions(db: Db, filter: SessionFilter = {}): Promise<SessionSummary[]> {
  const { rows } = await db.query(
    `SELECT x.*,
            COALESCE(k.confirmed, 0)::int AS confirmed_count,
            COALESCE(k.waitlist, 0)::int AS waitlist_count,
            COALESCE(k.checked_in, 0)::int AS checked_in_count,
            GREATEST(x.capacity - COALESCE(k.confirmed, 0), 0)::int AS seats_left,
            CASE WHEN mine.id IS NULL THEN NULL ELSE json_build_object(
              'id', mine.id, 'status', mine.status, 'waitlist_position', mine.waitlist_position,
              'promotion_offered_at', mine.promotion_offered_at) END AS my_booking
       FROM (${SESSION_SELECT}
              WHERE ($1::timestamptz IS NULL OR s.starts_at >= $1)
                AND ($2::timestamptz IS NULL OR s.starts_at < $2)
                AND ($3::uuid IS NULL OR s.class_type_id = $3)
                AND ($4::uuid IS NULL OR s.coach_id = $4)
                AND ($5::uuid IS NULL OR s.branch_id IS NULL OR s.branch_id = $5)
                AND ($6::text[] IS NULL OR s.status = ANY ($6))
                AND ($8::uuid IS NULL OR s.id = $8)
              ORDER BY s.starts_at
              LIMIT 500) x
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (WHERE b.${SEATS_HELD}) AS confirmed,
                count(*) FILTER (WHERE b.status = 'waitlist') AS waitlist,
                count(*) FILTER (WHERE b.status IN ('checked_in', 'completed')) AS checked_in
           FROM gym.bookings b WHERE b.session_id = x.id
       ) k ON true
       LEFT JOIN LATERAL (
         SELECT b.id, b.status, b.waitlist_position, b.promotion_offered_at FROM gym.bookings b
          WHERE b.session_id = x.id AND b.customer_id = $7 AND b.status <> 'cancelled'
          ORDER BY b.created_at DESC LIMIT 1
       ) mine ON $7::uuid IS NOT NULL
      ORDER BY x.starts_at`,
    [
      filter.from ?? null,
      filter.to ?? null,
      filter.classTypeId ?? null,
      filter.coachId ?? null,
      filter.branchId ?? null,
      filter.statuses ?? null,
      filter.customerId ?? null,
      filter.id ?? null,
    ]
  );
  return rows as SessionSummary[];
}

export async function getSession(db: Db, id: string, customerId?: string): Promise<SessionSummary | null> {
  const [session] = await listSessions(db, { id, customerId });
  return session ?? null;
}

export interface RosterEntry {
  id: string;
  customer_id: string;
  name: string | null;
  phone: string;
  status: BookingStatus;
  waitlist_position: number | null;
  source: "member" | "admin";
  late_cancel: boolean;
  promotion_offered_at: Date | null;
  checked_in_at: Date | null;
  cancelled_at: Date | null;
  created_at: Date;
}

export async function sessionRoster(db: Db, sessionId: string): Promise<RosterEntry[]> {
  const { rows } = await db.query(
    `SELECT b.id, b.customer_id, c.name, c.phone, b.status, b.waitlist_position, b.source, b.late_cancel,
            b.promotion_offered_at, b.checked_in_at, b.cancelled_at, b.created_at
       FROM gym.bookings b JOIN pos.pos_customers c ON c.id = b.customer_id
      WHERE b.session_id = $1
      ORDER BY CASE b.status WHEN 'checked_in' THEN 0 WHEN 'confirmed' THEN 1 WHEN 'completed' THEN 2
                             WHEN 'waitlist' THEN 3 WHEN 'no_show' THEN 4 ELSE 5 END,
               b.waitlist_position NULLS FIRST, b.created_at`,
    [sessionId]
  );
  return rows as RosterEntry[];
}

export interface CancelInfo {
  deadline: Date;
  /** Batal sekarang = batal terlambat. */
  late: boolean;
  /** Kredit yang hangus bila dibatalkan sekarang. */
  penalty_credits: number;
  policy: CreditPolicy;
}

/**
 * Pratinjau batal untuk portal member: kapan batas gratis dan berapa kredit
 * hangus bila dibatalkan sekarang. Aturan dibaca sekali per cabang.
 */
export async function attachCancelInfo<T extends { branch_id: string | null; starts_at: Date; credit_cost: number }>(
  db: Db,
  rows: T[],
  bookingStatus: (row: T) => BookingStatus | null,
  now = new Date()
): Promise<Array<T & { cancel_info: CancelInfo | null }>> {
  const rulesFor = branchRules(db);
  return Promise.all(
    rows.map(async (row) => {
      const status = bookingStatus(row);
      if (status !== "confirmed") return { ...row, cancel_info: null };
      const rules = await rulesFor(row.branch_id);
      const outcome = evaluateCancellation({
        bookingStatus: status,
        startsAt: row.starts_at,
        creditCost: row.credit_cost,
        rules,
        now,
      });
      return {
        ...row,
        cancel_info: {
          deadline: outcome.deadline,
          late: outcome.late,
          penalty_credits: outcome.penaltyCredits,
          policy: rules.lateCancelPolicy,
        },
      };
    })
  );
}

/* ── Admin: booking & log gate ───────────────────────────────────────── */

export interface BookingListFilter {
  from: Date;
  to: Date;
  status: string | null;
  q: string | null;
  sessionId: string | null;
}

/** Booking per jadwal sesi untuk halaman admin; status di luar daftar diabaikan. */
export async function listBookings(db: Db, filter: BookingListFilter) {
  const status = filter.status && (BOOKING_STATUSES as readonly string[]).includes(filter.status) ? filter.status : null;
  const { rows } = await db.query(
    `SELECT b.id, b.status, b.waitlist_position, b.source, b.late_cancel, b.promotion_offered_at,
            b.checked_in_at, b.cancelled_at, b.created_at,
            c.id AS customer_id, c.name AS member_name, c.phone AS member_phone,
            s.id AS session_id, s.starts_at, s.credit_cost, t.name AS class_type_name, co.name AS coach_name
       FROM gym.bookings b
       JOIN gym.class_sessions s ON s.id = b.session_id
       JOIN gym.class_types t ON t.id = s.class_type_id
       LEFT JOIN gym.coaches co ON co.id = s.coach_id
       JOIN pos.pos_customers c ON c.id = b.customer_id
      WHERE s.starts_at >= $1 AND s.starts_at < $2
        AND ($3::text IS NULL OR b.status = $3)
        AND ($4::text IS NULL OR c.name ILIKE '%' || $4 || '%' OR c.phone ILIKE '%' || $4 || '%')
        AND ($5::uuid IS NULL OR b.session_id = $5)
      ORDER BY s.starts_at, b.created_at
      LIMIT 500`,
    [filter.from, filter.to, status, filter.q, filter.sessionId]
  );
  return rows;
}

/** 100 scan gym terakhir + ringkasan hari ini (WIB). */
export async function loadAccessLog(db: Db) {
  const [{ rows }, { rows: today }] = await Promise.all([
    db.query(
      `SELECT l.id, l.decision, l.reason, l.entry_kind, l.credit_delta, l.source, l.created_at,
              c.name AS member_name, c.phone AS member_phone, t.name AS class_type_name, s.starts_at,
              u.full_name AS staff_name
         FROM gym.access_logs l
         LEFT JOIN pos.pos_customers c ON c.id = l.customer_id
         LEFT JOIN gym.bookings b ON b.id = l.booking_id
         LEFT JOIN gym.class_sessions s ON s.id = b.session_id
         LEFT JOIN gym.class_types t ON t.id = s.class_type_id
         LEFT JOIN configuration.users u ON u.id = l.scanned_by
        ORDER BY l.created_at DESC LIMIT 100`
    ),
    db.query(
      `SELECT count(*) FILTER (WHERE decision = 'allowed' AND entry_kind = 'booking')::int AS checked_in,
              count(*) FILTER (WHERE decision = 'denied')::int AS denied,
              COALESCE(-sum(credit_delta), 0)::int AS credits
         FROM gym.access_logs
        WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta'`
    ),
  ]);
  return { log: rows, today: today[0] };
}
