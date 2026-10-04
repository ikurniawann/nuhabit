import "server-only";
/**
 * CRM → Engagement (dashboard): challenge, event & peserta, pengumuman, log
 * check-in. Alur member (booking, QR, hadiah challenge) ada di ./server.
 */
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { getPool } from "@/lib/db";
import { isPortalLink } from "@/lib/member-portal/links";
import { challengeProgress } from "./rules";
import { challengeValues, type ChallengeRow } from "./server";

const endsAfterStart = { message: "Selesai harus setelah mulai" };

// ── Challenge ──────────────────────────────────────────────────────────────

export const challengeSchema = z
  .object({
    id: z.string().uuid().optional(),
    title: z.string().trim().min(3).max(120),
    description: z.string().max(1_000).default(""),
    metric: z.enum(["visits", "spend"]),
    target: z.number().positive().max(1_000_000_000),
    starts_at: z.string().datetime({ offset: true }),
    ends_at: z.string().datetime({ offset: true }),
    reward_xp: z.number().int().min(0).max(1_000_000),
    reward_ark_idr: z.number().min(0).max(100_000_000),
    is_active: z.boolean(),
  })
  .refine((c) => new Date(c.ends_at) > new Date(c.starts_at), endsAfterStart);

/** Semua challenge (atau satu bila `id`) dengan jumlah peserta & yang selesai. */
async function challengeRows(id: string | null) {
  const { rows } = await getPool().query(
    `SELECT c.*, c.target::float AS target, c.reward_ark_idr::float AS reward_ark_idr,
            count(j.*)::int AS participant_count,
            count(j.rewarded_at)::int AS completed_count
       FROM crm.challenges c LEFT JOIN crm.challenge_joins j ON j.challenge_id = c.id
      WHERE ($1::uuid IS NULL OR c.id = $1)
      GROUP BY c.id ORDER BY c.ends_at DESC`,
    [id]
  );
  return rows;
}

export const listChallenges = () => challengeRows(null);

/** Peserta satu challenge dengan progresnya, tertinggi dulu. */
export async function loadChallengeParticipants(id: string) {
  const challenge = (await challengeRows(id))[0] as ChallengeRow | undefined;
  if (!challenge) throw ApiError.notFound("Challenge tidak ditemukan");
  const values = await challengeValues(challenge);
  const { rows: people } = await getPool().query(
    `SELECT j.customer_id, j.joined_at, j.rewarded_at, c.name, c.phone
       FROM crm.challenge_joins j JOIN pos.pos_customers c ON c.id = j.customer_id
      WHERE j.challenge_id = $1`,
    [challenge.id]
  );
  const participants = people
    .map((p) => ({ ...p, ...challengeProgress(values.get(p.customer_id) ?? 0, Number(challenge.target)) }))
    .sort((a, b) => b.value - a.value);
  return { challenge, participants };
}

/** Buat atau ubah challenge. */
export async function saveChallenge(c: z.infer<typeof challengeSchema>): Promise<{ id: string }> {
  const params = [
    c.title, c.description, c.metric, c.target, c.starts_at, c.ends_at, c.reward_xp, c.reward_ark_idr, c.is_active,
  ];
  const { rows } = c.id
    ? await getPool().query<{ id: string }>(
        `UPDATE crm.challenges SET title=$1, description=$2, metric=$3, target=$4, starts_at=$5, ends_at=$6,
                reward_xp=$7, reward_ark_idr=$8, is_active=$9, updated_at=now()
          WHERE id=$10 RETURNING id`,
        [...params, c.id]
      )
    : await getPool().query<{ id: string }>(
        `INSERT INTO crm.challenges (title, description, metric, target, starts_at, ends_at, reward_xp,
                                     reward_ark_idr, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        params
      );
  if (!rows[0]) throw ApiError.notFound("Challenge tidak ditemukan");
  return rows[0];
}

// ── Event ──────────────────────────────────────────────────────────────────

export const eventSchema = z
  .object({
    id: z.string().uuid().optional(),
    title: z.string().trim().min(3).max(120),
    description: z.string().max(2_000).default(""),
    host_name: z.string().trim().max(120).optional().nullable(),
    location: z.string().trim().max(160).optional().nullable(),
    starts_at: z.string().datetime({ offset: true }),
    ends_at: z.string().datetime({ offset: true }),
    capacity: z.number().int().min(1).max(10_000),
    price_idr: z.number().min(0).max(100_000_000).default(0),
    booking_closes_hours: z.number().int().min(0).max(720).default(0),
    cancel_deadline_hours: z.number().int().min(0).max(720).default(2),
    status: z.enum(["draft", "published"]),
  })
  .refine((e) => new Date(e.ends_at) > new Date(e.starts_at), endsAfterStart);

/** Semua event, terdekat dulu, dengan hitungan peserta. */
export async function listEvents() {
  const { rows } = await getPool().query(
    `SELECT e.*, e.price_idr::float AS price_idr,
            count(b.*) FILTER (WHERE b.status IN ('confirmed', 'attended'))::int AS confirmed_count,
            count(b.*) FILTER (WHERE b.status = 'waitlist')::int AS waitlist_count,
            count(b.*) FILTER (WHERE b.status = 'attended')::int AS attended_count
       FROM crm.events e LEFT JOIN crm.event_bookings b ON b.event_id = e.id
      GROUP BY e.id
      ORDER BY (e.ends_at < now()), e.starts_at`
  );
  return rows;
}

/** Buat atau ubah event. Event yang dibatalkan tidak bisa diubah lagi. */
export async function saveEvent(e: z.infer<typeof eventSchema>): Promise<{ id: string }> {
  const params = [
    e.title, e.description, e.host_name ?? null, e.location ?? null, e.starts_at, e.ends_at,
    e.capacity, e.price_idr, e.booking_closes_hours, e.cancel_deadline_hours, e.status,
  ];
  const { rows } = e.id
    ? await getPool().query<{ id: string }>(
        `UPDATE crm.events SET title=$1, description=$2, host_name=$3, location=$4, starts_at=$5, ends_at=$6,
                capacity=$7, price_idr=$8, booking_closes_hours=$9, cancel_deadline_hours=$10, status=$11,
                updated_at=now()
          WHERE id=$12 AND status <> 'cancelled' RETURNING id`,
        [...params, e.id]
      )
    : await getPool().query<{ id: string }>(
        `INSERT INTO crm.events (title, description, host_name, location, starts_at, ends_at, capacity,
                                 price_idr, booking_closes_hours, cancel_deadline_hours, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        params
      );
  if (!rows[0]) throw ApiError.notFound("Event tidak ditemukan atau sudah dibatalkan");
  return rows[0];
}

/** Peserta event: terkonfirmasi, waitlist, lalu sisanya. */
export async function listEventBookings(eventId: string) {
  const { rows } = await getPool().query(
    `SELECT b.id, b.status, b.waitlist_position, b.late_cancel, b.created_at, b.cancelled_at,
            c.name, c.phone
       FROM crm.event_bookings b JOIN pos.pos_customers c ON c.id = b.customer_id
      WHERE b.event_id = $1
      ORDER BY array_position(ARRAY['confirmed','attended','waitlist','no_show','cancelled'], b.status),
               b.waitlist_position NULLS LAST, b.created_at`,
    [eventId]
  );
  return rows;
}

// ── Pengumuman & check-in ──────────────────────────────────────────────────

const audienceSchema = z.object({
  tier_codes: z.array(z.string().min(1).max(40)).max(20).optional(),
  min_visits: z.number().int().min(0).max(10_000).optional(),
  inactive_days: z.number().int().min(0).max(3_650).optional(),
});

export const announcementSchema = z.object({
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(3).max(1_000),
  kind: z.enum(["announcement", "promo"]),
  audience: audienceSchema,
  /** URL gambar hasil unggah (announcements/image). */
  image_url: z.string().trim().max(500).regex(/^(\/api\/files\/|https:\/\/)/, "URL gambar tidak valid").nullable().optional(),
  /** Tujuan dalam portal: "events", "promo:KODE", dst. (lib/member-portal/links). */
  link_url: z.string().trim().max(60).refine(isPortalLink, "Tujuan portal tidak dikenal").nullable().optional(),
  /** true = hanya hitung penerima, tidak mengirim. */
  preview: z.boolean().optional(),
});

/** Riwayat pengumuman, terbaru dulu, dengan jumlah yang sudah dibaca. */
export async function listAnnouncements() {
  const { rows } = await getPool().query(
    `SELECT a.id, a.title, a.body, a.kind, a.audience, a.recipient_count, a.sent_at, a.image_url, a.link_url,
            (SELECT count(*)::int FROM crm.member_notifications n
              WHERE n.announcement_id = a.id AND n.read_at IS NOT NULL) AS read_count
       FROM crm.member_announcements a ORDER BY a.sent_at DESC NULLS LAST LIMIT 100`
  );
  return rows;
}

/** 200 scan QR terakhir (diterima maupun ditolak) + ringkasan hari ini (WIB). */
export async function loadCheckinLog() {
  const pool = getPool();
  const [{ rows }, { rows: today }] = await Promise.all([
    pool.query(
      `SELECT k.id, k.decision, k.reason, k.created_at, c.name AS member_name, c.phone AS member_phone,
              u.full_name AS cashier_name
         FROM crm.member_checkins k
         LEFT JOIN pos.pos_customers c ON c.id = k.customer_id
         LEFT JOIN configuration.users u ON u.id = k.scanned_by
        ORDER BY k.created_at DESC LIMIT 200`
    ),
    pool.query(
      `SELECT count(*) FILTER (WHERE decision = 'accepted')::int AS accepted,
              count(*) FILTER (WHERE decision = 'denied')::int AS denied,
              count(DISTINCT customer_id) FILTER (WHERE decision = 'accepted')::int AS members
         FROM crm.member_checkins
        WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta'`
    ),
  ]);
  return { checkins: rows, today: today[0] };
}
