import { query, queryOne } from "@/lib/db";
import { todayJakarta } from "@/lib/desktop/overview";

/** Denyut gym hari ini untuk dashboard eksekutif: kelas, booking, check-in, kredit. */

export interface GymSessionToday {
  id: string;
  kelas: string;
  coach: string | null;
  mulai: string;
  terisi: number;
  kapasitas: number;
  waitlist: number;
  status: string;
}

export interface GymPulse {
  kelasHariIni: number;
  bookingHariIni: number;
  checkinHariIni: number;
  /** Persen kursi terisi (booking aktif ÷ kapasitas) dari kelas hari ini. */
  isiKelasPersen: number;
  waitlistHariIni: number;
  paketTerjual30Hari: number;
  pendapatanPaket30Hari: number;
  kreditBeredar: number;
  sesi: GymSessionToday[];
}

/** null bila skema gym belum dimigrasi, supaya dashboard tidak mencatatnya sebagai kegagalan. */
export async function fetchGymPulse(): Promise<GymPulse | null> {
  const ready = await queryOne<{ ok: boolean }>(
    `SELECT to_regclass('gym.class_sessions') IS NOT NULL
        AND to_regclass('gym.credit_purchases') IS NOT NULL AS ok`
  );
  if (!ready?.ok) return null;

  const today = todayJakarta();
  const dayRange = `s.starts_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Jakarta')
                AND s.starts_at < (($1::date + 1)::timestamp AT TIME ZONE 'Asia/Jakarta')`;

  const [sesi, kredit] = await Promise.all([
    query<{
      id: string;
      kelas: string;
      coach: string | null;
      mulai: string;
      terisi: number;
      kapasitas: number;
      waitlist: number;
      checkin: number;
      status: string;
    }>(
      `SELECT s.id, t.name AS kelas, c.name AS coach, s.starts_at AS mulai, s.capacity AS kapasitas, s.status,
              count(b.id) FILTER (WHERE b.status IN ('confirmed','checked_in','completed'))::int AS terisi,
              count(b.id) FILTER (WHERE b.status = 'waitlist')::int AS waitlist,
              count(b.id) FILTER (WHERE b.status IN ('checked_in','completed'))::int AS checkin
         FROM gym.class_sessions s
         JOIN gym.class_types t ON t.id = s.class_type_id
         LEFT JOIN gym.coaches c ON c.id = s.coach_id
         LEFT JOIN gym.bookings b ON b.session_id = s.id
        WHERE ${dayRange} AND s.status <> 'cancelled' AND s.status <> 'draft'
        GROUP BY s.id, t.name, c.name
        ORDER BY s.starts_at`,
      [today]
    ),
    queryOne<{ terjual: number; pendapatan: number; beredar: number }>(
      `SELECT (SELECT count(*) FROM gym.credit_purchases
                WHERE status = 'paid' AND paid_at >= now() - interval '30 days')::int AS terjual,
              (SELECT COALESCE(sum(total_idr), 0) FROM gym.credit_purchases
                WHERE status = 'paid' AND paid_at >= now() - interval '30 days')::float8 AS pendapatan,
              (SELECT COALESCE(sum(amount), 0) FROM gym.credit_ledger)::int AS beredar`
    ),
  ]);

  const kapasitas = sesi.reduce((n, s) => n + Number(s.kapasitas), 0);
  const terisi = sesi.reduce((n, s) => n + Number(s.terisi), 0);
  return {
    kelasHariIni: sesi.length,
    bookingHariIni: terisi,
    checkinHariIni: sesi.reduce((n, s) => n + Number(s.checkin), 0),
    isiKelasPersen: kapasitas > 0 ? Math.round((terisi / kapasitas) * 100) : 0,
    waitlistHariIni: sesi.reduce((n, s) => n + Number(s.waitlist), 0),
    paketTerjual30Hari: Number(kredit?.terjual ?? 0),
    pendapatanPaket30Hari: Number(kredit?.pendapatan ?? 0),
    kreditBeredar: Number(kredit?.beredar ?? 0),
    sesi: sesi.map((s) => ({
      id: s.id,
      kelas: s.kelas,
      coach: s.coach,
      mulai: new Date(s.mulai).toISOString(),
      terisi: Number(s.terisi),
      kapasitas: Number(s.kapasitas),
      waitlist: Number(s.waitlist),
      status: s.status,
    })),
  };
}
