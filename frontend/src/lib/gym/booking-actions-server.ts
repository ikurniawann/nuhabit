import "server-only";
/**
 * Tulis booking: ambil kursi/waitlist, batal (dengan aturan batal terlambat),
 * promosi waitlist, terima tawaran kursi, dan no-show. Setiap fungsi berjalan
 * di transaksi milik pemanggil. Kredit tidak dipotong saat booking.
 */
import type { PoolClient } from "pg";
import { notifyMember } from "@/lib/crm/engagement/server";
import { formatWib } from "@/lib/crm/engagement/rules";
import { getCoveredClassTypeIds, getCreditBalance } from "@/lib/gym/credits-server";
import { isClassTypeCovered } from "@/lib/gym/credits";
import { getGymRules } from "@/lib/gym/rules";
import {
  BOOKING_DENIAL_LABEL,
  canTransitionBooking,
  evaluateBookingEligibility,
  evaluateCancellation,
  planWaitlistPromotion,
  type BookingDenialReason,
} from "./booking";
import {
  applyNoShow,
  chargePenalty,
  lockBookingWithSession,
  lockSession,
  SchedulingError,
  SEATS_HELD,
  seatsHeld,
  sessionLabel,
  syncSessionSeats,
  type BookingRow,
  type SessionRow,
} from "./booking-store";

export interface BookResult {
  bookingId: string;
  status: "confirmed" | "waitlist";
  waitlistPosition: number | null;
}

const denial = (reason: BookingDenialReason) => new SchedulingError(BOOKING_DENIAL_LABEL[reason], 409, reason);

/**
 * Ambil kursi atau tempat waitlist. Baris sesi dikunci, jadi dua permintaan
 * untuk kursi terakhir berurutan: satu terkonfirmasi, berikutnya waitlist.
 */
export async function bookSession(
  client: PoolClient,
  input: { customerId: string; sessionId: string; source: "member" | "admin"; now?: Date }
): Promise<BookResult> {
  const now = input.now ?? new Date();
  const session = await lockSession(client, input.sessionId);
  const { rows: members } = await client.query(`SELECT is_active FROM pos.pos_customers WHERE id = $1`, [
    input.customerId,
  ]);
  if (!members[0]) throw new SchedulingError("Member tidak ditemukan", 404);

  const { rows: stats } = await client.query(
    `SELECT count(*) FILTER (WHERE ${SEATS_HELD})::int AS confirmed,
            COALESCE(max(waitlist_position) FILTER (WHERE status = 'waitlist'), 0)::int AS last_waitlist,
            COALESCE(bool_or(customer_id = $2 AND status IN ('confirmed', 'waitlist', 'checked_in')), false) AS mine
       FROM gym.bookings WHERE session_id = $1`,
    [session.id, input.customerId]
  );
  const decision = evaluateBookingEligibility({
    memberActive: members[0].is_active !== false,
    session,
    balance: await getCreditBalance(client, input.customerId),
    confirmedCount: stats[0].confirmed,
    lastWaitlistPosition: stats[0].last_waitlist,
    hasActiveBooking: stats[0].mine,
    now,
  });
  if (decision.kind === "deny") throw denial(decision.reason);
  // Paket bisa membatasi jenis kelas: saldo ada, tapi tidak berlaku untuk kelas ini.
  if (!isClassTypeCovered(await getCoveredClassTypeIds(client, input.customerId), session.class_type_id)) {
    throw new SchedulingError("Paket kredit Anda tidak mencakup kelas ini", 409, "package_not_covered");
  }

  const status = decision.kind === "confirm" ? "confirmed" : "waitlist";
  const position = decision.kind === "waitlist" ? decision.position : null;
  let bookingId: string;
  try {
    const { rows } = await client.query(
      `INSERT INTO gym.bookings (session_id, customer_id, status, waitlist_position, source)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [session.id, input.customerId, status, position, input.source]
    );
    bookingId = rows[0].id;
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw denial("already_booked");
    throw error;
  }
  if (status === "confirmed") await syncSessionSeats(client, session);

  await notifyMember(
    client,
    input.customerId,
    status === "confirmed"
      ? {
          type: "gym_booking_confirmed",
          title: `Terdaftar: ${session.class_type_name}`,
          body: `Sampai jumpa ${formatWib(session.starts_at)}. ${session.credit_cost} kredit dipotong saat check-in.`,
        }
      : {
          type: "gym_booking_waitlist",
          title: `Masuk waitlist: ${session.class_type_name}`,
          body: `Posisi Anda #${position}. Kami kabari bila ada kursi kosong.`,
        }
  );
  return { bookingId, status, waitlistPosition: position };
}

export interface CancelResult {
  late: boolean;
  deadline: Date;
  /** Kredit yang benar-benar dipotong karena batal terlambat. */
  penaltyCredits: number;
  promoted: { customerId: string; mode: "auto" | "offer" } | null;
}

/**
 * Lepas kursi. Batal setelah batas gratis memotong kredit sesi bila
 * kebijakannya forfeit; kursi yang lepas jatuh ke antrean waitlist terdepan.
 * `customerId` diisi saat member membatalkan sendiri (cek kepemilikan).
 */
export async function cancelBooking(
  client: PoolClient,
  input: { bookingId: string; customerId?: string; now?: Date }
): Promise<CancelResult> {
  const now = input.now ?? new Date();
  const { booking, session } = await lockBookingWithSession(client, input.bookingId, input.customerId);
  if (!canTransitionBooking(booking.status, "cancelled")) {
    throw new SchedulingError("Booking ini tidak bisa dibatalkan lagi");
  }
  const rules = await getGymRules(client, session.branch_id);
  const outcome = evaluateCancellation({
    bookingStatus: booking.status,
    startsAt: session.starts_at,
    creditCost: session.credit_cost,
    rules,
    now,
  });

  await client.query(
    `UPDATE gym.bookings
        SET status = 'cancelled', waitlist_position = NULL, promotion_offered_at = NULL,
            late_cancel = $2, cancelled_at = $3, updated_at = now()
      WHERE id = $1`,
    [booking.id, outcome.late, now]
  );
  const penaltyCredits = await chargePenalty(client, {
    customerId: booking.customer_id,
    amount: outcome.penaltyCredits,
    sourceType: "late_cancel",
    bookingId: booking.id,
    note: `Batal terlambat: ${sessionLabel(session)}`,
  });

  let promoted: CancelResult["promoted"] = null;
  if (booking.status === "confirmed") {
    promoted = await promoteWaitlist(client, session, rules.waitlistAutoPromote, now);
    await syncSessionSeats(client, session);
  }

  // Member yang membatalkan sendiri sudah melihat hasilnya di layar.
  if (!input.customerId) {
    await notifyMember(client, booking.customer_id, {
      type: "gym_booking_cancelled",
      title: `Booking dibatalkan: ${session.class_type_name}`,
      body: penaltyCredits
        ? `Booking ${formatWib(session.starts_at)} dibatalkan setelah batas gratis; ${penaltyCredits} kredit hangus.`
        : `Booking ${formatWib(session.starts_at)} dibatalkan.`,
    });
  }
  return { late: outcome.late, deadline: outcome.deadline, penaltyCredits, promoted };
}

/** Berikan kursi yang lepas ke antrean terdepan: langsung (auto) atau ditawarkan (offer). */
async function promoteWaitlist(
  client: PoolClient,
  session: SessionRow,
  autoPromote: boolean,
  now: Date
): Promise<CancelResult["promoted"]> {
  const { rows } = await client.query(
    `SELECT id, customer_id, status, waitlist_position, promotion_offered_at, created_at
       FROM gym.bookings WHERE session_id = $1 AND status = 'waitlist' FOR UPDATE`,
    [session.id]
  );
  const plan = planWaitlistPromotion(rows as Array<BookingRow>, { waitlistAutoPromote: autoPromote });
  if (!plan) return null;
  const { booking, mode } = plan;

  if (mode === "auto") {
    await client.query(
      `UPDATE gym.bookings SET status = 'confirmed', waitlist_position = NULL, updated_at = now() WHERE id = $1`,
      [booking.id]
    );
    await notifyMember(client, booking.customer_id, {
      type: "gym_waitlist_promoted",
      title: `Kursi tersedia: ${session.class_type_name}`,
      body: `Anda naik dari waitlist dan sudah terdaftar untuk ${formatWib(session.starts_at)}.`,
    });
  } else {
    await client.query(`UPDATE gym.bookings SET promotion_offered_at = $2, updated_at = now() WHERE id = $1`, [
      booking.id,
      now,
    ]);
    await notifyMember(client, booking.customer_id, {
      type: "gym_waitlist_offer",
      title: `Kursi ditawarkan: ${session.class_type_name}`,
      body: `Ada kursi kosong untuk ${formatWib(session.starts_at)}. Konfirmasi di portal sebelum diambil member lain.`,
    });
  }
  return { customerId: booking.customer_id, mode };
}

/** Member menerima kursi yang ditawarkan dari waitlist (kebijakan offer). */
export async function confirmWaitlistOffer(
  client: PoolClient,
  input: { bookingId: string; customerId: string }
): Promise<void> {
  const { booking, session } = await lockBookingWithSession(client, input.bookingId, input.customerId);
  if (booking.status !== "waitlist" || !booking.promotion_offered_at) {
    throw new SchedulingError("Belum ada kursi yang ditawarkan untuk Anda di kelas ini");
  }
  if ((await seatsHeld(client, session.id)) >= session.capacity) {
    throw new SchedulingError("Kursi itu sudah diambil member lain");
  }
  await client.query(
    `UPDATE gym.bookings SET status = 'confirmed', waitlist_position = NULL, promotion_offered_at = NULL,
            updated_at = now() WHERE id = $1`,
    [booking.id]
  );
  await syncSessionSeats(client, session);
}

/** Tandai tidak datang; kredit sesi hangus bila kebijakan no-show forfeit. */
export async function markNoShow(client: PoolClient, input: { bookingId: string }): Promise<{ penaltyCredits: number }> {
  const { booking, session } = await lockBookingWithSession(client, input.bookingId);
  if (!canTransitionBooking(booking.status, "no_show")) {
    throw new SchedulingError("Hanya booking terkonfirmasi yang bisa ditandai tidak hadir");
  }
  return { penaltyCredits: await applyNoShow(client, booking, session) };
}
