import "server-only";
// EPIC-031 Fase B1 — sisi server kuota harian venue: hitung okupansi live
// (booking online + walk-in loket) dan guard anti-oversell DI BAWAH advisory
// lock. Semua fungsi menerima PoolClient supaya berjalan DI DALAM transaksi
// pemanggil (create booking / registrasi loket) — jangan panggil di luar
// withTransaction untuk jalur tulis.

import type { PoolClient } from "pg";
import { ApiError } from "@/lib/api/auth";
import { query } from "@/lib/db";
import { addDaysIso } from "./calendar";
import {
  CAPACITY_HOLDING_BOOKING_STATUSES,
  isCapacityExceeded,
  resolveDailyCapacity,
  type CapacityDateRange,
} from "./capacity";

export interface VenueScope {
  companyId: string;
  branchId: string;
}

/**
 * Serialisasi transaksi kapasitas per (venue, tanggal) — advisory lock
 * transaksional (lepas otomatis saat COMMIT/ROLLBACK). Dua transaksi pada
 * tanggal yang sama antre; tanggal/venue berbeda jalan paralel. Tabrakan
 * hash antar-kunci hanya menambah serialisasi, tidak salah hasil.
 */
export async function acquireCapacityLock(
  client: PoolClient,
  scope: VenueScope,
  date: string
): Promise<void> {
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
    [scope.branchId, date]
  );
}

/**
 * Kapasitas efektif tanggal ini dari config: default venue + override
 * aktif yang mencakup tanggal (overlap → terkecil, resolver murni).
 * null = unlimited (kuota tidak aktif).
 */
export async function loadEffectiveCapacity(
  client: PoolClient,
  scope: VenueScope,
  date: string
): Promise<number | null> {
  const settings = await client.query<{ daily_capacity: number | null }>(
    `SELECT daily_capacity FROM ticketing.ticket_settings
     WHERE branch_id = $1 AND company_id = $2`,
    [scope.branchId, scope.companyId]
  );
  // Venue belum bootstrap settings = belum pernah set kuota → unlimited
  const venueDefault = settings.rows[0]?.daily_capacity ?? null;

  const overrides = await client.query<CapacityDateRange>(
    `SELECT start_date::text AS start_date, end_date::text AS end_date,
            capacity, is_active
     FROM ticketing.ticket_capacity_dates
     WHERE branch_id = $1 AND company_id = $2 AND is_active = true
       AND start_date <= $3::date AND $3::date <= end_date`,
    [scope.branchId, scope.companyId, date]
  );
  return resolveDailyCapacity(date, venueDefault, overrides.rows);
}

/**
 * Okupansi live satu tanggal (per ORANG) — hitung ulang dari sumber, tanpa
 * counter (jangan percaya state):
 *   • Online: guest booking ber-status memegang kuota (menunggu-bayar =
 *     reservasi, terbayar, digunakan). kedaluwarsa/dibatalkan/hangus lepas.
 *   • Walk-in: gelang terdaftar di visit non-void yang dibuka tanggal itu
 *     (WIB). Visit hasil REDEEM booking DIKECUALIKAN — orangnya sudah
 *     terhitung di sisi booking (anti dobel-hitung, keputusan owner 25 Jul).
 */
export async function countCapacityUsed(
  client: PoolClient,
  scope: VenueScope,
  date: string
): Promise<number> {
  const result = await client.query<{ online: string; walk_in: string }>(
    `SELECT
       (SELECT COUNT(*)
        FROM ticketing.ticket_booking_guests g
        JOIN ticketing.ticket_bookings b ON b.id = g.booking_id
        WHERE b.branch_id = $1 AND b.company_id = $2
          AND b.visit_date = $3::date
          AND b.status = ANY($4)) AS online,
       (SELECT COUNT(*)
        FROM ticketing.ticket_visit_bands vb
        JOIN ticketing.ticket_visits v ON v.id = vb.visit_id
        WHERE v.branch_id = $1 AND v.company_id = $2
          AND v.status <> 'void'
          AND (v.opened_at AT TIME ZONE 'Asia/Jakarta')::date = $3::date
          AND NOT EXISTS (
            SELECT 1 FROM ticketing.ticket_bookings bk
            WHERE bk.visit_id = v.id
          )) AS walk_in`,
    [
      scope.branchId,
      scope.companyId,
      date,
      [...CAPACITY_HOLDING_BOOKING_STATUSES],
    ]
  );
  const row = result.rows[0];
  return Number(row.online) + Number(row.walk_in);
}

/**
 * Status ketersediaan per tanggal utk kalender publik (B3). HANYA tanggal
 * bermasalah yang dikembalikan — tanggal tersedia diomit (payload kecil,
 * dan angka sisa/kapasitas TIDAK pernah bocor ke publik, keputusan owner).
 */
export type UnavailableKind = "sold_out" | "closed";

async function loadCapacityConfig(scope: VenueScope, from: string, to: string) {
  const [settingsRows, overrideRows] = await Promise.all([
    query<{ daily_capacity: number | null }>(
      `SELECT daily_capacity FROM ticketing.ticket_settings
       WHERE branch_id = $1 AND company_id = $2`,
      [scope.branchId, scope.companyId]
    ),
    query<CapacityDateRange>(
      `SELECT start_date::text AS start_date, end_date::text AS end_date,
              capacity, is_active
       FROM ticketing.ticket_capacity_dates
       WHERE branch_id = $1 AND company_id = $2 AND is_active = true
         AND start_date <= $4::date AND $3::date <= end_date`,
      [scope.branchId, scope.companyId, from, to]
    ),
  ]);
  return {
    venueDefault: settingsRows[0]?.daily_capacity ?? null,
    overrides: overrideRows,
  };
}

/** Okupansi per tanggal (online & walk-in terpisah) dalam rentang. */
async function loadUsedByDate(scope: VenueScope, from: string, to: string) {
  const [onlineRows, walkInRows] = await Promise.all([
    query<{ d: string; n: string }>(
      `SELECT b.visit_date::text AS d, COUNT(*) AS n
       FROM ticketing.ticket_booking_guests g
       JOIN ticketing.ticket_bookings b ON b.id = g.booking_id
       WHERE b.branch_id = $1 AND b.company_id = $2
         AND b.visit_date BETWEEN $3::date AND $4::date
         AND b.status = ANY($5)
       GROUP BY b.visit_date`,
      [scope.branchId, scope.companyId, from, to, [...CAPACITY_HOLDING_BOOKING_STATUSES]]
    ),
    query<{ d: string; n: string }>(
      `SELECT (v.opened_at AT TIME ZONE 'Asia/Jakarta')::date::text AS d,
              COUNT(*) AS n
       FROM ticketing.ticket_visit_bands vb
       JOIN ticketing.ticket_visits v ON v.id = vb.visit_id
       WHERE v.branch_id = $1 AND v.company_id = $2
         AND v.status <> 'void'
         AND (v.opened_at AT TIME ZONE 'Asia/Jakarta')::date
             BETWEEN $3::date AND $4::date
         AND NOT EXISTS (
           SELECT 1 FROM ticketing.ticket_bookings bk WHERE bk.visit_id = v.id
         )
       GROUP BY 1`,
      [scope.branchId, scope.companyId, from, to]
    ),
  ]);
  const map = new Map<string, { online: number; walkIn: number }>();
  for (const r of onlineRows) {
    map.set(r.d, { online: Number(r.n), walkIn: 0 });
  }
  for (const r of walkInRows) {
    const prev = map.get(r.d) ?? { online: 0, walkIn: 0 };
    map.set(r.d, { ...prev, walkIn: Number(r.n) });
  }
  return map;
}

/** Baris okupansi harian utk dashboard ops (Fase C) — angka boleh tampil. */
export interface OccupancyDay {
  date: string;
  online: number;
  walk_in: number;
  /** null = unlimited (kuota tidak aktif utk tanggal ini). */
  capacity: number | null;
}

/**
 * Okupansi per tanggal dalam rentang [from..to] — read-only, utk kalender
 * okupansi dashboard Booking, kartu laporan, dan peringatan pengaturan.
 * Berbeda dari buildAvailability: angka SELALU dihitung walau kuota
 * non-aktif (dashboard tetap perlu lihat jumlah pengunjung).
 */
export async function buildOccupancy(
  scope: VenueScope,
  from: string,
  to: string
): Promise<OccupancyDay[]> {
  const [{ venueDefault, overrides }, usedByDate] = await Promise.all([
    loadCapacityConfig(scope, from, to),
    loadUsedByDate(scope, from, to),
  ]);
  const days: OccupancyDay[] = [];
  for (let date = from; date <= to; date = addDaysIso(date, 1)) {
    const used = usedByDate.get(date) ?? { online: 0, walkIn: 0 };
    days.push({
      date,
      online: used.online,
      walk_in: used.walkIn,
      capacity: resolveDailyCapacity(date, venueDefault, overrides),
    });
  }
  return days;
}

/**
 * Peta tanggal tidak-tersedia dalam rentang [from..to] (inklusif) —
 * read-only tanpa lock (kalender indikatif; kebenaran final tetap guard
 * transaksi create). Fast path: kuota venue non-aktif & tanpa override →
 * langsung {} tanpa query okupansi.
 */
export async function buildAvailability(
  scope: VenueScope,
  from: string,
  to: string
): Promise<Record<string, UnavailableKind>> {
  const { venueDefault, overrides } = await loadCapacityConfig(scope, from, to);
  if (venueDefault === null && overrides.length === 0) return {};

  const usedByDate = await loadUsedByDate(scope, from, to);
  const result: Record<string, UnavailableKind> = {};
  for (let date = from; date <= to; date = addDaysIso(date, 1)) {
    const capacity = resolveDailyCapacity(date, venueDefault, overrides);
    if (capacity === null) continue;
    const used = usedByDate.get(date) ?? { online: 0, walkIn: 0 };
    if (capacity === 0) result[date] = "closed";
    else if (used.online + used.walkIn >= capacity) result[date] = "sold_out";
  }
  return result;
}

// ── Timed-entry slot (Fase D) ─────────────────────────────────────────

export interface BookingSlot {
  id: string;
  label: string;
  start_time: string; // "HH:MM:SS"
  end_time: string;
  /** null = tanpa batas per-slot (jendela jam saja). */
  capacity: number | null;
}

const SLOT_COLUMNS = `id, label, start_time::text AS start_time,
  end_time::text AS end_time, capacity`;

/** Jam WIB sekarang "HH:MM" — pasangan todayInJakarta (booking.ts). */
export function nowJakartaTime(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

/** Semua slot aktif venue (urut sort_order, jam mulai) — pool, read-only. */
export async function loadActiveSlots(scope: VenueScope): Promise<BookingSlot[]> {
  return query<BookingSlot>(
    `SELECT ${SLOT_COLUMNS} FROM ticketing.ticket_time_slots
     WHERE branch_id = $1 AND company_id = $2 AND is_active = true
     ORDER BY sort_order, start_time`,
    [scope.branchId, scope.companyId]
  );
}

/** Satu slot aktif via client transaksi — utk validasi create booking. */
export async function loadActiveSlot(
  client: PoolClient,
  scope: VenueScope,
  slotId: string
): Promise<BookingSlot | null> {
  const result = await client.query<BookingSlot>(
    `SELECT ${SLOT_COLUMNS} FROM ticketing.ticket_time_slots
     WHERE id = $1 AND branch_id = $2 AND company_id = $3 AND is_active = true`,
    [slotId, scope.branchId, scope.companyId]
  );
  return result.rows[0] ?? null;
}

/** Orang terpakai per slot utk satu tanggal (booking pemegang kuota). */
export async function countSlotUsedByDate(
  scope: VenueScope,
  date: string
): Promise<Map<string, number>> {
  const rows = await query<{ slot_id: string; n: string }>(
    `SELECT b.slot_id, COUNT(*) AS n
     FROM ticketing.ticket_booking_guests g
     JOIN ticketing.ticket_bookings b ON b.id = g.booking_id
     WHERE b.branch_id = $1 AND b.company_id = $2
       AND b.visit_date = $3::date AND b.slot_id IS NOT NULL
       AND b.status = ANY($4)
     GROUP BY b.slot_id`,
    [scope.branchId, scope.companyId, date, [...CAPACITY_HOLDING_BOOKING_STATUSES]]
  );
  return new Map(rows.map((r) => [r.slot_id, Number(r.n)]));
}

/**
 * Guard kuota per (tanggal, slot) — pola sama assertCapacityAvailable:
 * slot tanpa batas = no-op; advisory lock (venue, tanggal) re-entrant
 * dengan guard harian (kunci sama dalam transaksi sama = aman) → hitung
 * live → 409. Panggil SETELAH guard harian dalam transaksi create.
 */
export async function assertSlotCapacity(
  client: PoolClient,
  scope: VenueScope,
  date: string,
  slot: BookingSlot,
  additional: number
): Promise<void> {
  if (slot.capacity === null) return;

  await acquireCapacityLock(client, scope, date);
  const result = await client.query<{ n: string }>(
    `SELECT COUNT(*) AS n
     FROM ticketing.ticket_booking_guests g
     JOIN ticketing.ticket_bookings b ON b.id = g.booking_id
     WHERE b.branch_id = $1 AND b.company_id = $2
       AND b.visit_date = $3::date AND b.slot_id = $4
       AND b.status = ANY($5)`,
    [scope.branchId, scope.companyId, date, slot.id, [...CAPACITY_HOLDING_BOOKING_STATUSES]]
  );
  if (isCapacityExceeded(slot.capacity, Number(result.rows[0].n), additional)) {
    throw new CapacityFullError(
      `Slot ${slot.label} pada tanggal ini sudah penuh — pilih slot lain`
    );
  }
}

/** 409 kuota penuh — ApiError supaya apiHandler meneruskan pesannya. */
export class CapacityFullError extends ApiError {
  constructor(message = "Kuota tanggal ini sudah penuh — pilih tanggal lain") {
    super(409, message);
    this.name = "CapacityFullError";
  }
}

/**
 * Guard lengkap: lock → resolve kapasitas → hitung okupansi → throw 409
 * bila `used + additional` melebihi. No-op cepat bila kuota tidak aktif
 * (unlimited) — TANPA lock, jalur existing bebas overhead.
 */
export async function assertCapacityAvailable(
  client: PoolClient,
  scope: VenueScope,
  date: string,
  additional: number
): Promise<void> {
  // Cek murah dulu tanpa lock: kuota non-aktif → tidak ada yang di-guard
  const capacityBefore = await loadEffectiveCapacity(client, scope, date);
  if (capacityBefore === null) return;

  await acquireCapacityLock(client, scope, date);
  // Resolve ULANG di bawah lock — config bisa berubah di antara dua bacaan
  const capacity = await loadEffectiveCapacity(client, scope, date);
  if (capacity === null) return;

  const used = await countCapacityUsed(client, scope, date);
  if (isCapacityExceeded(capacity, used, additional)) {
    throw new CapacityFullError(
      capacity === 0
        ? "Tanggal ini ditutup untuk kunjungan — pilih tanggal lain"
        : "Kuota tanggal ini sudah penuh — pilih tanggal lain"
    );
  }
}
