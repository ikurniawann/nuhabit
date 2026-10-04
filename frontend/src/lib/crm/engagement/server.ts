import { randomBytes } from "crypto";
import type { Pool, PoolClient } from "pg";
import { afterCommit, getPool, withTransaction } from "@/lib/db";
import { createPgClient } from "@/lib/pg/create-client";
import { awardChallengeXp } from "@/lib/crm/loyalty-engine";
import { getCrmDefaultVenue } from "@/lib/crm/server";
import { sendAnnouncementPush, sendMemberPush } from "@/lib/member-portal/push";
import { DEFAULT_POS_LOYALTY_SETTINGS } from "@/lib/pos/loyalty-settings";
import {
  audienceWhere,
  challengeProgress,
  checkQrToken,
  evaluateBooking,
  formatWib,
  isLateCancel,
  pickWaitlistPromotion,
  QR_TOKEN_PREFIX,
  QR_TTL_SECONDS,
  type AnnouncementAudience,
  type BookingDecision,
  type ChallengeMetric,
  type QrProblem,
} from "./rules";

type Db = Pool | PoolClient;

/* ── Notifikasi ──────────────────────────────────────────────────────── */

export async function notifyMember(
  db: Db,
  customerId: string,
  notification: { type: string; title: string; body: string }
) {
  await db.query(
    `INSERT INTO crm.member_notifications (customer_id, type, title, body) VALUES ($1, $2, $3, $4)`,
    [customerId, notification.type, notification.title, notification.body]
  );
  // Push menunggu COMMIT: booking yang batal tidak boleh mengirim push.
  afterCommit(db, () => void sendMemberPush(customerId, notification));
}

export async function countAudience(audience: AnnouncementAudience): Promise<number> {
  const where = audienceWhere(audience);
  const { rows } = await getPool().query(
    `SELECT count(*)::int AS n FROM pos.pos_customers c WHERE ${where.sql}`,
    where.params
  );
  return rows[0]?.n ?? 0;
}

/**
 * Simpan pengumuman lalu salin ke kotak masuk setiap member di audiens,
 * termasuk gambar dan tautan dalam portal. Setelah commit, push ke perangkat
 * penerima yang berlangganan (best effort, tidak ditunggu).
 */
export async function sendAnnouncement(input: {
  title: string;
  body: string;
  kind: "announcement" | "promo";
  audience: AnnouncementAudience;
  createdBy: string | null;
  imageUrl?: string | null;
  linkUrl?: string | null;
}) {
  const imageUrl = input.imageUrl || null;
  const linkUrl = input.linkUrl || null;
  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO crm.member_announcements (title, body, kind, audience, created_by, sent_at, image_url, link_url)
       VALUES ($1, $2, $3, $4, $5, now(), $6, $7) RETURNING id`,
      [input.title, input.body, input.kind, JSON.stringify(input.audience), input.createdBy, imageUrl, linkUrl]
    );
    const id = rows[0].id as string;
    const where = audienceWhere(input.audience);
    const offset = where.params.length;
    const fanOut = await client.query(
      `INSERT INTO crm.member_notifications (customer_id, type, title, body, announcement_id, image_url, link_url)
       SELECT c.id, $${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}
         FROM pos.pos_customers c WHERE ${where.sql}`,
      [...where.params, input.kind, input.title, input.body, id, imageUrl, linkUrl]
    );
    await client.query(`UPDATE crm.member_announcements SET recipient_count = $1 WHERE id = $2`, [
      fanOut.rowCount ?? 0,
      id,
    ]);
    return { id, recipients: fanOut.rowCount ?? 0 };
  });
  void sendAnnouncementPush(result.id, { title: input.title, body: input.body, link: linkUrl, type: input.kind });
  return result;
}

/* ── QR check-in ─────────────────────────────────────────────────────── */

export async function issueMemberQr(customerId: string) {
  const token = QR_TOKEN_PREFIX + randomBytes(16).toString("base64url").toLowerCase();
  const { rows } = await getPool().query(
    `INSERT INTO crm.member_qr_tokens (token, customer_id, expires_at)
     VALUES ($1, $2, now() + make_interval(secs => $3))
     RETURNING token, issued_at, expires_at`,
    [token, customerId, QR_TTL_SECONDS]
  );
  // Token kedaluwarsa tidak berguna lagi; bersihkan sambil lalu.
  void getPool()
    .query(`DELETE FROM crm.member_qr_tokens WHERE expires_at < now() - interval '1 day'`)
    .catch(() => {});
  return rows[0] as { token: string; issued_at: string; expires_at: string };
}

export type QrScanResult =
  | { ok: true; customerId: string; name: string | null; phone: string }
  | { ok: false; problem: QrProblem };

/**
 * Konsumsi QR di kasir. Scan yang ditolak tetap dicatat: log check-in adalah
 * catatan apa yang terjadi di kasir, bukan hanya siapa yang lolos.
 */
export function scanMemberQr(rawToken: string, scannedBy: string | null): Promise<QrScanResult> {
  const token = rawToken.trim().toLowerCase();
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT t.token, t.customer_id, t.expires_at, t.consumed_at, c.name, c.phone
         FROM crm.member_qr_tokens t JOIN pos.pos_customers c ON c.id = t.customer_id
        WHERE t.token = $1 FOR UPDATE OF t`,
      [token]
    );
    const row = rows[0] ?? null;
    const problem = checkQrToken(row, new Date());
    await client.query(
      `INSERT INTO crm.member_checkins (customer_id, decision, reason, scanned_by) VALUES ($1, $2, $3, $4)`,
      [row?.customer_id ?? null, problem ? "denied" : "accepted", problem, scannedBy]
    );
    if (problem) return { ok: false, problem };
    await client.query(`UPDATE crm.member_qr_tokens SET consumed_at = now() WHERE token = $1`, [token]);
    await notifyMember(client, row.customer_id, {
      type: "visit_recorded",
      title: "Kunjungan tercatat",
      body: `Terima kasih sudah mampir${row.name ? `, ${row.name}` : ""}. Kunjungan ${formatWib(new Date())} sudah tercatat.`,
    });
    return { ok: true, customerId: row.customer_id, name: row.name, phone: row.phone };
  });
}

/* ── Booking event ───────────────────────────────────────────────────── */

/** Kunci baris event agar dua pendaftar terakhir tidak sama-sama dapat kursi. */
export function bookEvent(customerId: string, eventId: string): Promise<BookingDecision> {
  return withTransaction(async (client) => {
    const { rows: events } = await client.query(
      `SELECT * FROM crm.events WHERE id = $1 FOR UPDATE`,
      [eventId]
    );
    const event = events[0];
    if (!event) return { kind: "deny", reason: "event_not_open" };

    const { rows: stats } = await client.query(
      `SELECT count(*) FILTER (WHERE status IN ('confirmed', 'attended'))::int AS confirmed,
              COALESCE(max(waitlist_position) FILTER (WHERE status = 'waitlist'), 0)::int AS last_waitlist,
              bool_or(customer_id = $2 AND status IN ('confirmed', 'waitlist', 'attended')) AS mine
         FROM crm.event_bookings WHERE event_id = $1`,
      [eventId, customerId]
    );
    const decision = evaluateBooking({
      event: { ...event, capacity: Number(event.capacity) },
      confirmedCount: stats[0].confirmed,
      lastWaitlistPosition: stats[0].last_waitlist,
      hasActiveBooking: stats[0].mine === true,
      now: new Date(),
    });
    if (decision.kind === "deny") return decision;

    await client.query(
      `INSERT INTO crm.event_bookings (event_id, customer_id, status, waitlist_position) VALUES ($1, $2, $3, $4)`,
      [eventId, customerId, decision.kind === "confirm" ? "confirmed" : "waitlist",
        decision.kind === "waitlist" ? decision.position : null]
    );
    await notifyMember(client, customerId,
      decision.kind === "confirm"
        ? { type: "booking_confirmed", title: `Terdaftar: ${event.title}`, body: `Sampai jumpa ${formatWib(event.starts_at)}.` }
        : { type: "booking_waitlist", title: `Masuk waitlist: ${event.title}`, body: `Posisi Anda #${decision.position}. Kami kabari bila ada kursi kosong.` }
    );
    return decision;
  });
}

/** Naikkan antrean waitlist terdepan ke kursi yang baru kosong. */
async function promoteWaitlist(client: PoolClient, event: { id: string; title: string; starts_at: string }) {
  const { rows } = await client.query(
    `SELECT id, customer_id, status, waitlist_position, created_at
       FROM crm.event_bookings WHERE event_id = $1 AND status = 'waitlist'`,
    [event.id]
  );
  const next = pickWaitlistPromotion(rows);
  if (!next) return;
  await client.query(
    `UPDATE crm.event_bookings SET status = 'confirmed', waitlist_position = NULL, updated_at = now() WHERE id = $1`,
    [next.id]
  );
  await notifyMember(client, next.customer_id, {
    type: "waitlist_promoted",
    title: `Kursi tersedia: ${event.title}`,
    body: `Anda naik dari waitlist dan sudah terdaftar untuk ${formatWib(event.starts_at)}.`,
  });
}

export type BookingChange = "cancelled" | "attended" | "no_show";

/**
 * Ubah status booking (member membatalkan, atau staf menandai hadir/absen).
 * Kursi yang dilepas booking confirmed langsung diberikan ke waitlist.
 */
export function changeBooking(
  bookingId: string,
  next: BookingChange,
  opts: { customerId?: string } = {}
): Promise<{ ok: true; lateCancel: boolean } | { ok: false; error: string }> {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT b.*, e.title, e.starts_at, e.cancel_deadline_hours
         FROM crm.event_bookings b JOIN crm.events e ON e.id = b.event_id
        WHERE b.id = $1 FOR UPDATE OF b`,
      [bookingId]
    );
    const booking = rows[0];
    if (!booking || (opts.customerId && booking.customer_id !== opts.customerId)) {
      return { ok: false, error: "Booking tidak ditemukan" };
    }
    const allowed: Record<string, BookingChange[]> = {
      confirmed: ["cancelled", "attended", "no_show"],
      waitlist: ["cancelled"],
      attended: [],
      cancelled: [],
      no_show: [],
    };
    if (!allowed[booking.status]?.includes(next)) {
      return { ok: false, error: "Status booking ini tidak bisa diubah lagi" };
    }
    const lateCancel = next === "cancelled" && booking.status === "confirmed" && isLateCancel(booking, new Date());
    await client.query(
      `UPDATE crm.event_bookings
          SET status = $2, late_cancel = $3, waitlist_position = NULL, updated_at = now(),
              cancelled_at = CASE WHEN $2 = 'cancelled' THEN now() ELSE cancelled_at END
        WHERE id = $1`,
      [bookingId, next, lateCancel]
    );
    if (next === "cancelled" && booking.status === "confirmed") {
      await promoteWaitlist(client, { id: booking.event_id, title: booking.title, starts_at: booking.starts_at });
    }
    return { ok: true, lateCancel };
  });
}

/** Batalkan event: semua booking aktif batal dan setiap member dikabari. */
export function cancelEvent(eventId: string) {
  return withTransaction(async (client) => {
    const { rows: events } = await client.query(
      `UPDATE crm.events SET status = 'cancelled', updated_at = now() WHERE id = $1 RETURNING title, starts_at`,
      [eventId]
    );
    if (!events[0]) return 0;
    const { rows } = await client.query(
      `UPDATE crm.event_bookings SET status = 'cancelled', cancelled_at = now(), updated_at = now()
        WHERE event_id = $1 AND status IN ('confirmed', 'waitlist') RETURNING customer_id`,
      [eventId]
    );
    for (const row of rows) {
      await notifyMember(client, row.customer_id, {
        type: "event_cancelled",
        title: `Dibatalkan: ${events[0].title}`,
        body: `Event ${formatWib(events[0].starts_at)} dibatalkan. Mohon maaf atas ketidaknyamanannya.`,
      });
    }
    return rows.length;
  });
}

/* ── Challenge ───────────────────────────────────────────────────────── */

export interface ChallengeRow {
  id: string;
  title: string;
  description: string;
  metric: ChallengeMetric;
  target: number;
  starts_at: string;
  ends_at: string;
  reward_xp: number;
  reward_ark_idr: number;
  is_active: boolean;
}

/**
 * Progres = order lunas dalam jendela challenge. Kunjungan dihitung per hari
 * (WIB), jadi dua order di hari yang sama tetap satu kunjungan.
 */
export async function challengeValues(
  challenge: Pick<ChallengeRow, "id" | "metric" | "starts_at" | "ends_at">,
  customerIds?: string[]
): Promise<Map<string, number>> {
  const valueSql =
    challenge.metric === "visits"
      ? `count(DISTINCT (o.created_at AT TIME ZONE 'Asia/Jakarta')::date)`
      : `COALESCE(sum(o.total_amount), 0)`;
  const { rows } = await getPool().query(
    `SELECT j.customer_id, (
            SELECT ${valueSql} FROM pos.pos_orders o
             WHERE o.customer_id = j.customer_id AND o.payment_status = 'paid'
               AND o.created_at BETWEEN $2 AND $3
          )::float AS value
       FROM crm.challenge_joins j
      WHERE j.challenge_id = $1 AND ($4::uuid[] IS NULL OR j.customer_id = ANY($4))`,
    [challenge.id, challenge.starts_at, challenge.ends_at, customerIds ?? null]
  );
  return new Map(rows.map((r) => [r.customer_id as string, Number(r.value) || 0]));
}

/**
 * Bagikan hadiah challenge yang sudah tercapai — dievaluasi saat member
 * membuka portal (lazy, seperti badge). Penanda rewarded_at diambil lebih dulu
 * dengan UPDATE bersyarat, jadi dua permintaan bersamaan tidak memberi dobel.
 */
export async function settleChallengeRewards(customerId: string) {
  const pool = getPool();
  const { rows: pending } = await pool.query(
    `SELECT c.* FROM crm.challenge_joins j JOIN crm.challenges c ON c.id = j.challenge_id
      WHERE j.customer_id = $1 AND j.rewarded_at IS NULL`,
    [customerId]
  );
  for (const challenge of pending as ChallengeRow[]) {
    const value = (await challengeValues(challenge, [customerId])).get(customerId) ?? 0;
    if (!challengeProgress(value, Number(challenge.target)).completed) continue;

    const claimed = await pool.query(
      `UPDATE crm.challenge_joins SET rewarded_at = now()
        WHERE challenge_id = $1 AND customer_id = $2 AND rewarded_at IS NULL`,
      [challenge.id, customerId]
    );
    if (claimed.rowCount === 0) continue;

    const rewards: string[] = [];
    if (challenge.reward_xp > 0) {
      const db = createPgClient();
      const venue = await getCrmDefaultVenue(db);
      await awardChallengeXp(db, {
        customerId,
        challengeId: challenge.id,
        challengeTitle: challenge.title,
        xpAmount: challenge.reward_xp,
        companyId: venue.companyId,
        branchId: venue.branchId,
      });
      rewards.push(`${challenge.reward_xp} XP`);
    }
    if (Number(challenge.reward_ark_idr) > 0) {
      const ark = await creditArkBonus(customerId, Number(challenge.reward_ark_idr), `Hadiah challenge: ${challenge.title}`);
      rewards.push(`${ark} ARK Coin`);
    }
    await notifyMember(pool, customerId, {
      type: "challenge_completed",
      title: `Challenge selesai: ${challenge.title}`,
      body: rewards.length ? `Hadiah ${rewards.join(" + ")} sudah masuk ke akun Anda.` : "Selamat, target tercapai!",
    });
  }
}

/** Tambah saldo ARK (disimpan dalam Rupiah) sebagai transaksi wallet "bonus". */
function creditArkBonus(customerId: string, amountIdr: number, notes: string): Promise<number> {
  return withTransaction(async (client) => {
    const { rows: rateRows } = await client.query(
      `SELECT ark_rate::float AS ark_rate FROM pos.pos_loyalty_settings
        WHERE is_active ORDER BY updated_at DESC LIMIT 1`
    );
    const rate = Number(rateRows[0]?.ark_rate) || DEFAULT_POS_LOYALTY_SETTINGS.ark_rate;
    const { rows } = await client.query(
      `UPDATE pos.pos_customers SET ark_coin_balance = COALESCE(ark_coin_balance, 0) + $2, updated_at = now()
        WHERE id = $1 RETURNING ark_coin_balance::float AS after`,
      [customerId, amountIdr]
    );
    const after = Number(rows[0]?.after) || 0;
    const arkCoins = Math.round((amountIdr / rate) * 100) / 100;
    await client.query(
      `INSERT INTO pos.pos_wallet_transactions
         (customer_id, type, amount, ark_coins, balance_before, balance_after, status, notes)
       VALUES ($1, 'bonus', $2, $3, $4, $5, 'completed', $6)`,
      [customerId, amountIdr, arkCoins, after - amountIdr, after, notes]
    );
    return arkCoins;
  });
}
