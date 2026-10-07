import { ApiError } from "@/lib/api/auth";
import { query, queryOne, withTransaction } from "@/lib/db";
import { parseIcs, toHolidayCandidates, type HolidayCandidate } from "./holiday-ics";
import { indexHolidays, type HolidayIndex, type HolidayRow, type HolidayType } from "./holidays";
import {
  defaultDeductsLeave,
  holidayTypeOrDefault,
  type HolidayBody,
  type HolidayImportItem,
} from "./holidays-input";

/**
 * Akses database hari libur (EPIC-036). Dipisah dari `holidays.ts` supaya
 * modul murni itu tetap bisa diimpor komponen client tanpa menyeret
 * `@/lib/db` ke bundle browser.
 */

/**
 * Hanya baris `aktif`: baris `draft` (hasil impor yang belum disetujui HRD)
 * tidak boleh mempengaruhi perhitungan apa pun.
 */
export async function loadHolidayIndex(startIso: string, endIso: string): Promise<HolidayIndex> {
  const rows = await query<HolidayRow>(
    `SELECT holiday_date::text AS holiday_date, name, type, deducts_leave
       FROM hris.public_holidays
      WHERE deleted_at IS NULL
        AND status = 'aktif'
        AND holiday_date BETWEEN $1::date AND $2::date
      ORDER BY holiday_date, name`,
    [startIso, endIso]
  );
  return indexHolidays(rows);
}

export interface HolidayApiRow {
  id: string;
  holiday_date: string;
  name: string;
  type: HolidayType;
  deducts_leave: boolean;
  status: "draft" | "aktif";
  source: "manual" | "impor";
  note: string | null;
}

const SELECT_COLUMNS = `id, holiday_date::text AS holiday_date, name, type,
          deducts_leave, status, source, note`;

const DUPLICATE_MESSAGE = "Libur dengan tanggal dan nama yang sama sudah ada";

/** Bentrok unique (tanggal+nama) → 409 berpesan jelas. */
async function withDuplicateGuard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if ((error as { code?: string } | null)?.code === "23505") {
      throw ApiError.conflict(DUPLICATE_MESSAGE);
    }
    throw error;
  }
}

export async function listHolidays(start: string, end: string, includeDraft: boolean) {
  return query<HolidayApiRow>(
    `SELECT ${SELECT_COLUMNS}
     FROM hris.public_holidays
     WHERE deleted_at IS NULL
       AND holiday_date BETWEEN $1::date AND $2::date
       AND ($3::boolean OR status = 'aktif')
     ORDER BY holiday_date ASC, name ASC`,
    [start, end, includeDraft]
  );
}

/** Body sudah lolos validateHolidayBody. */
export async function createHoliday(body: HolidayBody, userId: string) {
  const type = holidayTypeOrDefault(body.type);
  return withDuplicateGuard(() =>
    queryOne<HolidayApiRow>(
      `INSERT INTO hris.public_holidays
         (holiday_date, name, type, deducts_leave, status, source, note, created_by, updated_by)
       VALUES ($1::date, $2, $3, $4, $5, 'manual', $6, $7, $7)
       RETURNING ${SELECT_COLUMNS}`,
      [
        body.holiday_date,
        body.name?.trim(),
        type,
        body.deducts_leave ?? defaultDeductsLeave(type),
        body.status ?? "aktif",
        body.note?.trim() || null,
        userId,
      ]
    )
  );
}

/** Body sudah lolos validateHolidayPatch; return null bila tidak ditemukan. */
export async function updateHoliday(id: string, body: HolidayBody, userId: string) {
  // Mengubah tipe tanpa menyebut deducts_leave akan meninggalkan baris yang
  // bertentangan dengan aturan SKB; ikutkan default tipenya.
  const deductsLeave = body.deducts_leave ?? (body.type ? body.type === "cuti_bersama" : null);
  return withDuplicateGuard(() =>
    queryOne<{ id: string; name: string }>(
      `UPDATE hris.public_holidays SET
         holiday_date  = COALESCE($2::date, holiday_date),
         name          = COALESCE($3, name),
         type          = COALESCE($4, type),
         deducts_leave = COALESCE($5, deducts_leave),
         status        = COALESCE($6, status),
         -- note dibedakan: COALESCE membuat catatan mustahil dikosongkan
         -- (null = "jangan ubah"). Flag $8 memisahkan "tidak dikirim" dari
         -- "dikirim kosong".
         note          = CASE WHEN $8::boolean THEN $7 ELSE note END,
         updated_by    = $9,
         updated_at    = now()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id, name`,
      [
        id,
        body.holiday_date ?? null,
        body.name?.trim() ?? null,
        body.type ?? null,
        deductsLeave,
        body.status ?? null,
        body.note?.trim() || null,
        body.note !== undefined,
        userId,
      ]
    )
  );
}

/**
 * Soft delete: baris dirujuk perhitungan cuti historis, dan index unique-nya
 * parsial (WHERE deleted_at IS NULL) sehingga tanggal+nama sama bisa
 * ditambahkan lagi.
 */
export async function softDeleteHoliday(id: string, userId: string) {
  return queryOne<{ id: string; name: string }>(
    `UPDATE hris.public_holidays
     SET deleted_at = now(), updated_by = $2, updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING id, name`,
    [id, userId]
  );
}

/** URL kalender publik. Konstanta (bukan input pengguna) → tidak ada jalur SSRF. */
const ICS_URL =
  process.env.HRIS_HOLIDAY_ICS_URL ??
  "https://calendar.google.com/calendar/ical/id.indonesian%23holiday%40group.v.calendar.google.com/public/basic.ics";
const FETCH_TIMEOUT_MS = 12_000;
/** Kalender setahun ~50 KB; batas ini mencegah respons raksasa membebani server. */
const MAX_ICS_BYTES = 5_000_000;

async function fetchIcs(): Promise<string> {
  const res = await fetch(ICS_URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { Accept: "text/calendar" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Kalender sumber membalas HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_ICS_BYTES) throw new Error("Respons kalender terlalu besar, impor dibatalkan");
  if (!text.includes("BEGIN:VCALENDAR")) throw new Error("Respons kalender bukan berkas ICS yang valid");
  return text;
}

export interface HolidayPreviewRow extends HolidayCandidate {
  /** Sudah ada di tabel (cocok source_ref, atau tanggal+nama yang sama). */
  already_imported: boolean;
}

/**
 * Tarik ICS dan tandai kandidat yang sudah ada. Tidak menulis apa pun.
 * Jaringan keluar bisa diblokir: gagal tarik → 502 berpesan tindak lanjut,
 * hanya dialog impor yang mati.
 */
export async function previewHolidayImport(year: number): Promise<HolidayPreviewRow[]> {
  let ics: string;
  try {
    ics = await fetchIcs();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[holidays/import] fetch ICS gagal:", detail);
    throw new ApiError(
      502,
      `Tidak bisa mengambil kalender hari libur: ${detail}. Hari libur tetap bisa ditambahkan manual.`
    );
  }

  const existing = await query<{ source_ref: string | null; holiday_date: string; name: string }>(
    `SELECT source_ref, holiday_date::text AS holiday_date, name
       FROM hris.public_holidays
      WHERE deleted_at IS NULL
        AND holiday_date BETWEEN $1::date AND $2::date`,
    [`${year}-01-01`, `${year}-12-31`]
  );
  const bySourceRef = new Set(existing.map((row) => row.source_ref).filter(Boolean));
  const byDateName = new Set(existing.map((row) => `${row.holiday_date}|${row.name}`));

  return toHolidayCandidates(parseIcs(ics), year).map((candidate) => ({
    ...candidate,
    already_imported:
      bySourceRef.has(candidate.source_ref) ||
      byDateName.has(`${candidate.holiday_date}|${candidate.name}`),
  }));
}

/**
 * Simpan baris yang dicentang HRD dalam satu transaksi (impor separuh jalan
 * lebih membingungkan daripada gagal utuh). Item sudah lolos validateImportItem.
 */
export async function importHolidays(items: HolidayImportItem[], userId: string) {
  return withTransaction(async (client) => {
    let created = 0;
    let updated = 0;

    for (const item of items) {
      const type = holidayTypeOrDefault(item.type);
      const values = [
        item.holiday_date,
        item.name?.trim(),
        type,
        item.deducts_leave ?? type === "cuti_bersama",
        item.status ?? "aktif",
        item.source_ref ?? null,
        userId,
      ];

      // 1) Event yang sama (UID) sudah pernah diimpor → perbarui di tempat;
      //    impor ulang idempoten meski Google mengubah nama event.
      if (item.source_ref) {
        const bySourceRef = await client.query(
          `UPDATE hris.public_holidays SET
             holiday_date = $1::date, name = $2, type = $3,
             deducts_leave = $4, status = $5,
             updated_by = $7, updated_at = now()
           WHERE source_ref = $6 AND deleted_at IS NULL
           RETURNING id`,
          values
        );
        if ((bySourceRef.rowCount ?? 0) > 0) {
          updated += 1;
          continue;
        }
      }

      // 2) Tanggal+nama sama (mis. diketik manual HRD) diperbarui, bukan
      //    diduplikasi. `source` & `note` sengaja tidak ditimpa.
      const inserted = await client.query<{ inserted: boolean }>(
        `INSERT INTO hris.public_holidays
           (holiday_date, name, type, deducts_leave, status, source, source_ref,
            created_by, updated_by)
         VALUES ($1::date, $2, $3, $4, $5, 'impor', $6, $7, $7)
         ON CONFLICT (holiday_date, name) WHERE deleted_at IS NULL
         DO UPDATE SET
           type = EXCLUDED.type,
           deducts_leave = EXCLUDED.deducts_leave,
           status = EXCLUDED.status,
           source_ref = COALESCE(EXCLUDED.source_ref, hris.public_holidays.source_ref),
           updated_by = EXCLUDED.updated_by,
           updated_at = now()
         RETURNING (xmax = 0) AS inserted`,
        values
      );
      if (inserted.rows[0]?.inserted) created += 1;
      else updated += 1;
    }

    return { created, updated };
  });
}
