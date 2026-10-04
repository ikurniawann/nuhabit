import "server-only";
// Konfigurasi level venue untuk Pengaturan Tiket: baris settings, kanal
// penjualan, template slot waktu (EPIC-031 D), dan override kapasitas
// harian (EPIC-031 A3). Semua query di-scope (company, branch) venue.

import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { query, queryOne, withTransaction } from "@/lib/db";
import { isValidCalendarDate } from "./pricing";
import { PAYMENT_MODES, RE_ENTRY_POLICIES, type TicketingContext } from "./server";
import { conflictOnDuplicate, patchAssignments } from "./sql";

// ── Settings ──────────────────────────────────────────────────────────

interface SettingsRow {
  id: string;
  re_entry_policy: string;
  default_credit_limit: string;
  default_payment_mode: string;
  booking_slug: string | null;
  booking_forfeit_days: number | null;
  daily_capacity: number | null;
  slot_grace_minutes: number;
  updated_at: string;
}

const SETTINGS_COLUMNS = `id, re_entry_policy, default_credit_limit,
  default_payment_mode, booking_slug, booking_forfeit_days, daily_capacity,
  slot_grace_minutes, updated_at`;

/** Kanal default venue ($1 company, $2 branch, $3 user) — idempotent. */
export const DEFAULT_CHANNELS_SQL = `INSERT INTO ticketing.ticket_channels
   (company_id, branch_id, code, name, is_online, sort_order, created_by)
 VALUES
   ($1, $2, 'walk-in', 'Walk-in (Loket)', false, 10, $3),
   ($1, $2, 'website', 'Website Booking', true, 20, $3)
 ON CONFLICT (branch_id, code) DO NOTHING`;

/**
 * Bootstrap sekali jalan saat venue pertama kali membuka Ticketing:
 * baris settings + kanal default (walk-in/website). Ticket dibuat owner
 * lewat Master Ticket (revisi 2026-07-21) — tidak ada seed jenis tiket.
 * Idempotent via ON CONFLICT.
 */
async function ensureVenueDefaults(ctx: TicketingContext) {
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO ticketing.ticket_settings (company_id, branch_id, updated_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (branch_id) DO NOTHING`,
      [ctx.companyId, ctx.branchId, ctx.user.id]
    );
    await client.query(DEFAULT_CHANNELS_SQL, [ctx.companyId, ctx.branchId, ctx.user.id]);
  });
}

export async function getVenueSettings(ctx: TicketingContext) {
  await ensureVenueDefaults(ctx);
  return queryOne<SettingsRow>(
    `SELECT ${SETTINGS_COLUMNS} FROM ticketing.ticket_settings
     WHERE branch_id = $1 AND company_id = $2`,
    [ctx.branchId, ctx.companyId]
  );
}

// Segmen statis yang hidup berdampingan dgn [slug] di /booking/* dan
// /api/public/booking/* — dipakai venue = rute ambigu.
const RESERVED_BOOKING_SLUGS = new Set(["status", "webhook", "catalog", "api"]);

export const updateSettingsSchema = z.object({
  re_entry_policy: z.enum(RE_ENTRY_POLICIES).optional(),
  default_credit_limit: z.number().min(0).max(1_000_000_000).optional(),
  default_payment_mode: z.enum(PAYMENT_MODES).optional(),
  // Slug URL booking publik /booking/[slug] — null = booking online mati.
  // Kata yang menabrak segmen statis route /booking/* dilarang.
  booking_slug: z
    .string()
    .regex(/^[a-z0-9-]{2,50}$/, "Slug: huruf kecil, angka, tanda hubung (2-50)")
    .refine((s) => !RESERVED_BOOKING_SLUGS.has(s), {
      message: "Slug ini kata terpakai sistem — pilih slug lain",
    })
    .nullable()
    .optional(),
  // Masa berlaku redeem booking terbayar: hari-H + N hari; lewat itu →
  // hangus (pendapatan hangus). null = kebijakan belum diisi (SOP) —
  // tidak menghanguskan, redeem hanya hari-H.
  booking_forfeit_days: z.number().int().min(0).max(365).nullable().optional(),
  // EPIC-031: kuota harian venue (per ORANG, online + walk-in). null =
  // UNLIMITED (perilaku sebelum EPIC-031). Tanggal tutup (0) bukan di sini —
  // pakai override ticket_capacity_dates capacity 0.
  daily_capacity: z.number().int().min(1).max(1_000_000).nullable().optional(),
  // EPIC-031 D: toleransi jam masuk slot saat redeem (menit)
  slot_grace_minutes: z.number().int().min(0).max(240).optional(),
});

export async function updateVenueSettings(
  ctx: TicketingContext,
  body: z.infer<typeof updateSettingsSchema>
) {
  const { assignments, values } = patchAssignments(
    {
      re_entry_policy: body.re_entry_policy,
      default_credit_limit: body.default_credit_limit,
      default_payment_mode: body.default_payment_mode,
      booking_slug: body.booking_slug,
      booking_forfeit_days: body.booking_forfeit_days,
      daily_capacity: body.daily_capacity,
      slot_grace_minutes: body.slot_grace_minutes,
    },
    3
  );
  const rows = await conflictOnDuplicate(
    query<SettingsRow>(
      `UPDATE ticketing.ticket_settings
       SET ${["updated_at = now()", "updated_by = $3", ...assignments].join(", ")}
       WHERE branch_id = $1 AND company_id = $2
       RETURNING ${SETTINGS_COLUMNS}`,
      [ctx.branchId, ctx.companyId, ctx.user.id, ...values]
    ),
    "Slug booking sudah dipakai venue lain"
  );
  if (rows.length === 0) {
    throw ApiError.notFound("Pengaturan belum dibootstrap — buka halaman Ticketing dulu");
  }
  return rows[0];
}

// ── Kanal penjualan ───────────────────────────────────────────────────

const CHANNEL_COLUMNS = `id, code, name, is_online, sort_order, is_active,
  created_at, updated_at`;

export function listChannels(ctx: TicketingContext) {
  return query(
    `SELECT ${CHANNEL_COLUMNS}
     FROM ticketing.ticket_channels
     WHERE branch_id = $1 AND company_id = $2
     ORDER BY sort_order, name`,
    [ctx.branchId, ctx.companyId]
  );
}

export const updateChannelSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  is_active: z.boolean().optional(),
});

export async function updateChannel(
  ctx: TicketingContext,
  id: string,
  body: z.infer<typeof updateChannelSchema>
) {
  const { assignments, values } = patchAssignments(
    { name: body.name, is_active: body.is_active },
    3
  );
  const rows = await query(
    `UPDATE ticketing.ticket_channels
     SET ${["updated_at = now()", ...assignments].join(", ")}
     WHERE id = $1 AND branch_id = $2 AND company_id = $3
     RETURNING ${CHANNEL_COLUMNS}`,
    [id, ctx.branchId, ctx.companyId, ...values]
  );
  if (rows.length === 0) throw ApiError.notFound("Kanal tidak ditemukan");
  return rows[0];
}

// ── Slot waktu (EPIC-031 D) ───────────────────────────────────────────
// Hapus/nonaktif template TIDAK mengubah booking lama (label+jam di-
// snapshot ke booking). Hard delete sah: FK booking ON DELETE SET NULL.

interface TimeSlotRow {
  id: string;
  label: string;
  start_time: string;
  end_time: string;
  capacity: number | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const SLOT_COLUMNS = `id, label, start_time::text AS start_time,
  end_time::text AS end_time, capacity, sort_order, is_active,
  created_at, updated_at`;

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const timeField = z.string().regex(TIME_PATTERN, "Format jam HH:MM");
const SLOT_LABEL_TAKEN = "Label slot sudah dipakai — pilih label lain";
const SLOT_NOT_FOUND = "Slot waktu tidak ditemukan";

export function listTimeSlots(ctx: TicketingContext) {
  return query<TimeSlotRow>(
    `SELECT ${SLOT_COLUMNS} FROM ticketing.ticket_time_slots
     WHERE branch_id = $1 AND company_id = $2
     ORDER BY sort_order, start_time`,
    [ctx.branchId, ctx.companyId]
  );
}

export const createTimeSlotSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    start_time: timeField,
    end_time: timeField,
    // null = tanpa batas per-slot (jendela jam saja; kuota harian tetap)
    capacity: z.number().int().min(1).max(1_000_000).nullable().default(null),
    sort_order: z.number().int().min(0).max(1000).default(0),
  })
  .refine((b) => b.end_time > b.start_time, {
    message: "Jam selesai harus setelah jam mulai",
    path: ["end_time"],
  });

export async function createTimeSlot(
  ctx: TicketingContext,
  body: z.infer<typeof createTimeSlotSchema>
) {
  const rows = await conflictOnDuplicate(
    query<TimeSlotRow>(
      `INSERT INTO ticketing.ticket_time_slots
         (company_id, branch_id, label, start_time, end_time, capacity,
          sort_order, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${SLOT_COLUMNS}`,
      [
        ctx.companyId,
        ctx.branchId,
        body.label,
        body.start_time,
        body.end_time,
        body.capacity,
        body.sort_order,
        ctx.user.id,
      ]
    ),
    SLOT_LABEL_TAKEN
  );
  return rows[0];
}

export const updateTimeSlotSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  start_time: timeField.optional(),
  end_time: timeField.optional(),
  capacity: z.number().int().min(1).max(1_000_000).nullable().optional(),
  sort_order: z.number().int().min(0).max(1000).optional(),
  is_active: z.boolean().optional(),
});

export async function updateTimeSlot(
  ctx: TicketingContext,
  id: string,
  body: z.infer<typeof updateTimeSlotSchema>
) {
  const current = await queryOne<TimeSlotRow>(
    `SELECT ${SLOT_COLUMNS} FROM ticketing.ticket_time_slots
     WHERE id = $1 AND branch_id = $2 AND company_id = $3`,
    [id, ctx.branchId, ctx.companyId]
  );
  if (!current) throw ApiError.notFound(SLOT_NOT_FOUND);

  // Validasi jendela pakai nilai FINAL (gabungan lama + patch)
  const finalStart = body.start_time ?? current.start_time.slice(0, 5);
  const finalEnd = body.end_time ?? current.end_time.slice(0, 5);
  if (finalEnd <= finalStart) {
    throw ApiError.badRequest("Jam selesai harus setelah jam mulai");
  }

  const { assignments, values } = patchAssignments(
    {
      label: body.label,
      start_time: body.start_time,
      end_time: body.end_time,
      capacity: body.capacity,
      sort_order: body.sort_order,
      is_active: body.is_active,
    },
    3
  );
  const rows = await conflictOnDuplicate(
    query<TimeSlotRow>(
      `UPDATE ticketing.ticket_time_slots
       SET ${["updated_at = now()", ...assignments].join(", ")}
       WHERE id = $1 AND branch_id = $2 AND company_id = $3
       RETURNING ${SLOT_COLUMNS}`,
      [id, ctx.branchId, ctx.companyId, ...values]
    ),
    SLOT_LABEL_TAKEN
  );
  return rows[0];
}

export async function deleteTimeSlot(ctx: TicketingContext, id: string) {
  const rows = await query<{ id: string }>(
    `DELETE FROM ticketing.ticket_time_slots
     WHERE id = $1 AND branch_id = $2 AND company_id = $3
     RETURNING id`,
    [id, ctx.branchId, ctx.companyId]
  );
  if (rows.length === 0) throw ApiError.notFound(SLOT_NOT_FOUND);
}

// ── Override kapasitas harian (EPIC-031 A3) ───────────────────────────
// capacity 0 = tanggal tutup (online + walk-in); overlap antar rentang →
// resolver memakai kapasitas TERKECIL (capacity.ts). Hard delete sah:
// baris murni konfigurasi, tidak ada FK yang menunjuk ke sini.

interface CapacityDateRow {
  id: string;
  label: string;
  start_date: string;
  end_date: string;
  capacity: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const CAPACITY_DATE_COLUMNS = `id, label, start_date::text AS start_date,
  end_date::text AS end_date, capacity, is_active, created_at, updated_at`;

const CAPACITY_DATE_NOT_FOUND = "Override kapasitas tidak ditemukan";
const END_BEFORE_START = "Tanggal akhir tidak boleh sebelum tanggal mulai";
const startDateField = z.string().refine(isValidCalendarDate, "Tanggal mulai tidak valid");
const endDateField = z.string().refine(isValidCalendarDate, "Tanggal akhir tidak valid");

export function listCapacityDates(ctx: TicketingContext) {
  return query<CapacityDateRow>(
    `SELECT ${CAPACITY_DATE_COLUMNS}
     FROM ticketing.ticket_capacity_dates
     WHERE branch_id = $1 AND company_id = $2
     ORDER BY start_date DESC, created_at DESC`,
    [ctx.branchId, ctx.companyId]
  );
}

export const createCapacityDateSchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    start_date: startDateField,
    end_date: endDateField,
    // 0 = tanggal tutup (superset blok-online, berlaku juga utk walk-in)
    capacity: z.number().int().min(0).max(1_000_000),
  })
  .refine((b) => b.end_date >= b.start_date, {
    message: END_BEFORE_START,
    path: ["end_date"],
  });

export async function createCapacityDate(
  ctx: TicketingContext,
  body: z.infer<typeof createCapacityDateSchema>
) {
  const rows = await query<CapacityDateRow>(
    `INSERT INTO ticketing.ticket_capacity_dates
       (company_id, branch_id, label, start_date, end_date, capacity, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${CAPACITY_DATE_COLUMNS}`,
    [
      ctx.companyId,
      ctx.branchId,
      body.label,
      body.start_date,
      body.end_date,
      body.capacity,
      ctx.user.id,
    ]
  );
  return rows[0];
}

export const updateCapacityDateSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  start_date: startDateField.optional(),
  end_date: endDateField.optional(),
  capacity: z.number().int().min(0).max(1_000_000).optional(),
  is_active: z.boolean().optional(),
});

export async function updateCapacityDate(
  ctx: TicketingContext,
  id: string,
  body: z.infer<typeof updateCapacityDateSchema>
) {
  const current = await queryOne<CapacityDateRow>(
    `SELECT ${CAPACITY_DATE_COLUMNS}
     FROM ticketing.ticket_capacity_dates
     WHERE id = $1 AND branch_id = $2 AND company_id = $3`,
    [id, ctx.branchId, ctx.companyId]
  );
  if (!current) throw ApiError.notFound(CAPACITY_DATE_NOT_FOUND);

  // Validasi rentang pakai nilai FINAL (gabungan lama + patch) — patch
  // sebagian tidak boleh menghasilkan end < start
  const finalStart = body.start_date ?? current.start_date;
  const finalEnd = body.end_date ?? current.end_date;
  if (finalEnd < finalStart) throw ApiError.badRequest(END_BEFORE_START);

  const { assignments, values } = patchAssignments(
    {
      label: body.label,
      start_date: body.start_date,
      end_date: body.end_date,
      capacity: body.capacity,
      is_active: body.is_active,
    },
    3
  );
  const rows = await query<CapacityDateRow>(
    `UPDATE ticketing.ticket_capacity_dates
     SET ${["updated_at = now()", ...assignments].join(", ")}
     WHERE id = $1 AND branch_id = $2 AND company_id = $3
     RETURNING ${CAPACITY_DATE_COLUMNS}`,
    [id, ctx.branchId, ctx.companyId, ...values]
  );
  return rows[0];
}

export async function deleteCapacityDate(ctx: TicketingContext, id: string) {
  const rows = await query<{ id: string }>(
    `DELETE FROM ticketing.ticket_capacity_dates
     WHERE id = $1 AND branch_id = $2 AND company_id = $3
     RETURNING id`,
    [id, ctx.branchId, ctx.companyId]
  );
  if (rows.length === 0) throw ApiError.notFound(CAPACITY_DATE_NOT_FOUND);
}
