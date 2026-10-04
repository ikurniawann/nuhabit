import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { query, withTransaction } from "@/lib/db";
import { parseIcs, toHolidayCandidates, type HolidayCandidate } from "@/lib/hris/holiday-ics";
import type { HolidayType } from "@/lib/hris/holidays";

/**
 * Impor kalender hari libur (EPIC-036 Fase E).
 *
 *   GET  /api/hris/holidays/import?year=2026 — tarik ICS, kembalikan PREVIEW.
 *                                              Tidak menulis apa pun.
 *   POST /api/hris/holidays/import           — simpan baris yang dicentang HRD.
 *
 * Sengaja dua langkah dan tanpa cron: kalender sumber memuat tanggal yang bukan
 * tanggal merah dan menandai sebagian tanggal hijriah "(belum pasti)", sedangkan
 * daftar resmi terbit lewat SKB 3 Menteri. Angka di tabel ini menyetir potongan
 * jatah cuti — tidak boleh ada yang menulisnya diam-diam.
 */

const WRITE_ROLES = ["super_admin", "hrd"] as const;
const HOLIDAY_TYPES: HolidayType[] = ["nasional", "cuti_bersama", "perusahaan"];
const YEAR_RE = /^\d{4}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
  if (!res.ok) {
    throw new Error(`Kalender sumber membalas HTTP ${res.status}`);
  }
  const text = await res.text();
  if (text.length > MAX_ICS_BYTES) {
    throw new Error("Respons kalender terlalu besar, impor dibatalkan");
  }
  if (!text.includes("BEGIN:VCALENDAR")) {
    throw new Error("Respons kalender bukan berkas ICS yang valid");
  }
  return text;
}

interface PreviewRow extends HolidayCandidate {
  /** Sudah ada di tabel (cocok source_ref, atau tanggal+nama yang sama). */
  already_imported: boolean;
}

export async function GET(req: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.hrisKepegawaian);

    const yearParam = req.nextUrl.searchParams.get("year");
    const year = yearParam && YEAR_RE.test(yearParam)
      ? Number(yearParam)
      : new Date().getFullYear();

    let ics: string;
    try {
      ics = await fetchIcs();
    } catch (error) {
      // Jaringan keluar dari container bisa saja diblokir. Gagal dengan pesan
      // yang bisa ditindaklanjuti, dan JANGAN membuat halaman admin ikut mati —
      // 502 di sini hanya mematikan dialog impor.
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[holidays/import] fetch ICS gagal:", detail);
      return NextResponse.json(
        {
          error: `Tidak bisa mengambil kalender hari libur: ${detail}. ` +
            `Hari libur tetap bisa ditambahkan manual.`,
        },
        { status: 502 }
      );
    }

    const candidates = toHolidayCandidates(parseIcs(ics), year);

    const existing = await query<{ source_ref: string | null; holiday_date: string; name: string }>(
      `SELECT source_ref, holiday_date::text AS holiday_date, name
         FROM hris.public_holidays
        WHERE deleted_at IS NULL
          AND holiday_date BETWEEN $1::date AND $2::date`,
      [`${year}-01-01`, `${year}-12-31`]
    );
    const bySourceRef = new Set(existing.map((row) => row.source_ref).filter(Boolean));
    const byDateName = new Set(existing.map((row) => `${row.holiday_date}|${row.name}`));

    const data: PreviewRow[] = candidates.map((candidate) => ({
      ...candidate,
      already_imported:
        bySourceRef.has(candidate.source_ref) ||
        byDateName.has(`${candidate.holiday_date}|${candidate.name}`),
    }));

    return NextResponse.json({
      data,
      meta: {
        year,
        total: data.length,
        suggested: data.filter((row) => row.suggested).length,
        already_imported: data.filter((row) => row.already_imported).length,
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[holidays/import] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

interface ImportItem {
  source_ref?: string;
  holiday_date?: string;
  name?: string;
  type?: string;
  deducts_leave?: boolean;
  status?: string;
}

function validateItem(item: ImportItem): string | null {
  if (!item.holiday_date || !DATE_RE.test(item.holiday_date)) return "Tanggal tidak valid";
  if (!item.name?.trim()) return "Nama libur wajib diisi";
  if (item.type !== undefined && !HOLIDAY_TYPES.includes(item.type as HolidayType)) {
    return "Tipe libur tidak valid";
  }
  if (item.status !== undefined && !["draft", "aktif"].includes(item.status)) {
    return "Status tidak valid";
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireIamMenuPrefix(IAM.hrisKepegawaian);
    const body = (await req.json()) as { items?: ImportItem[] };
    const items = body.items ?? [];

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: "Tidak ada hari libur yang dicentang" },
        { status: 400 }
      );
    }
    for (const item of items) {
      const invalid = validateItem(item);
      if (invalid) {
        return NextResponse.json(
          { error: `${invalid}: ${item.name ?? item.holiday_date ?? "(tanpa nama)"}` },
          { status: 400 }
        );
      }
    }

    // Satu transaksi: impor separuh jalan lebih membingungkan daripada gagal utuh.
    const result = await withTransaction(async (client) => {
      let created = 0;
      let updated = 0;

      for (const item of items) {
        const type = (item.type as HolidayType | undefined) ?? "nasional";
        const values = [
          item.holiday_date,
          item.name!.trim(),
          type,
          item.deducts_leave ?? type === "cuti_bersama",
          item.status ?? "aktif",
          item.source_ref ?? null,
          user.id,
        ];

        // 1) Event yang sama (UID) sudah pernah diimpor → perbarui di tempat.
        //    Ini yang membuat impor ulang idempoten meski Google mengubah nama
        //    eventnya.
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

        // 2) Belum pernah diimpor. Tanggal+nama yang sama (mis. sudah diketik
        //    manual HRD) diperbarui, bukan diduplikasi — index unique-nya
        //    parsial sehingga predikatnya harus ikut disebut.
        //    `source` sengaja TIDAK ditimpa: baris yang aslinya manual tetap
        //    tercatat manual, dan `note` HRD tidak ikut terhapus.
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

    return NextResponse.json({
      data: result,
      message:
        `${result.created} hari libur ditambahkan` +
        (result.updated > 0 ? `, ${result.updated} diperbarui` : ""),
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[holidays/import] POST failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
