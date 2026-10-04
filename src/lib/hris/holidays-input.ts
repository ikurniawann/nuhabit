import { z } from "zod";
import type { HolidayType } from "./holidays";

/**
 * Validasi input hari libur (EPIC-036): tambah manual, ubah, dan impor ICS.
 * Pesan galat Indonesia per jalur dipertahankan seperti versi route lama.
 */

export const HOLIDAY_TYPES: readonly HolidayType[] = ["nasional", "cuti_bersama", "perusahaan"];
const HOLIDAY_STATUSES = ["draft", "aktif"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_RE = /^\d{4}$/;

export const holidayBodySchema = z.object({
  holiday_date: z.string().max(10).optional(),
  name: z.string().max(200).optional(),
  type: z.string().max(30).optional(),
  deducts_leave: z.boolean().optional(),
  status: z.string().max(10).optional(),
  note: z.string().max(2000).nullable().optional(),
});

export type HolidayBody = z.infer<typeof holidayBodySchema>;

export const holidayImportSchema = z.object({
  items: z
    .array(holidayBodySchema.omit({ note: true }).extend({ source_ref: z.string().max(500).optional() }))
    .max(500)
    .optional(),
});

export type HolidayImportItem = NonNullable<z.infer<typeof holidayImportSchema>["items"]>[number];

const isHolidayType = (value: string): value is HolidayType =>
  (HOLIDAY_TYPES as readonly string[]).includes(value);

function typeOrStatusError(body: { type?: string; status?: string }): string | null {
  if (body.type !== undefined && !isHolidayType(body.type)) return "Tipe libur tidak valid";
  if (body.status !== undefined && !HOLIDAY_STATUSES.includes(body.status)) return "Status tidak valid";
  return null;
}

/** POST tambah libur manual. */
export function validateHolidayBody(body: HolidayBody): string | null {
  if (!body.holiday_date || !DATE_RE.test(body.holiday_date)) return "Tanggal wajib diisi (YYYY-MM-DD)";
  if (Number.isNaN(new Date(`${body.holiday_date}T00:00:00Z`).getTime())) return "Tanggal tidak valid";
  if (!body.name?.trim()) return "Nama libur wajib diisi";
  return typeOrStatusError(body);
}

/** PATCH: field yang dikirim saja yang divalidasi. */
export function validateHolidayPatch(body: HolidayBody): string | null {
  if (body.holiday_date !== undefined && !DATE_RE.test(body.holiday_date)) {
    return "Tanggal tidak valid (YYYY-MM-DD)";
  }
  const typeError = typeOrStatusError(body);
  if (typeError) return typeError;
  if (body.name !== undefined && !body.name.trim()) return "Nama libur wajib diisi";
  return null;
}

/** Satu baris impor yang dicentang HRD. */
export function validateImportItem(item: HolidayImportItem): string | null {
  if (!item.holiday_date || !DATE_RE.test(item.holiday_date)) return "Tanggal tidak valid";
  if (!item.name?.trim()) return "Nama libur wajib diisi";
  return typeOrStatusError(item);
}

/**
 * Cuti bersama memotong jatah cuti tahunan menurut SKB; libur nasional tidak.
 * Default mengikuti tipe, tetap bisa ditimpa eksplisit dari form.
 */
export function defaultDeductsLeave(type: HolidayType): boolean {
  return type === "cuti_bersama";
}

export function holidayTypeOrDefault(type: string | undefined): HolidayType {
  return type !== undefined && isHolidayType(type) ? type : "nasional";
}

/**
 * Rentang baca: start_date+end_date (keduanya wajib bila salah satu ada),
 * atau satu tahun penuh (default tahun berjalan). Null = parameter salah.
 */
export function resolveHolidayRange(params: URLSearchParams, now = new Date()) {
  const start = params.get("start_date");
  const end = params.get("end_date");
  if (start || end) {
    if (!start || !DATE_RE.test(start) || !end || !DATE_RE.test(end)) return null;
    return { start, end };
  }
  const yearParam = params.get("year");
  const year = yearParam && YEAR_RE.test(yearParam) ? yearParam : String(now.getFullYear());
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

export function resolveImportYear(yearParam: string | null, now = new Date()): number {
  return yearParam && YEAR_RE.test(yearParam) ? Number(yearParam) : now.getFullYear();
}
