import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { query, queryOne } from "@/lib/db";
import { HR_ROLES } from "@/lib/hris/workforce-auth";
import type { HolidayType } from "@/lib/hris/holidays";

/**
 * GET  /api/hris/holidays — daftar hari libur pada satu rentang/tahun.
 * POST /api/hris/holidays — tambah hari libur (HRD).
 *
 * Baca sengaja terbuka untuk semua akun terautentikasi: kalender ESS karyawan
 * memerlukannya untuk menampilkan tanggal merah. Isinya kalender publik, bukan
 * data pribadi. Baris `draft` (hasil impor yang belum disetujui) hanya keluar
 * untuk role HR lewat include_draft — supaya karyawan tidak melihat tanggal
 * yang belum tentu jadi libur.
 *
 * Tulis dibatasi super_admin + hrd (EPIC-036): angka di sini menyetir potongan
 * jatah cuti.
 */

const WRITE_ROLES = ["super_admin", "hrd"] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_RE = /^\d{4}$/;
const HOLIDAY_TYPES: HolidayType[] = ["nasional", "cuti_bersama", "perusahaan"];
const UNIQUE_VIOLATION = "23505";

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

export async function GET(req: NextRequest) {
  try {
    const user = await requireApiUser();
    const params = req.nextUrl.searchParams;

    const startParam = params.get("start_date");
    const endParam = params.get("end_date");
    const yearParam = params.get("year");

    let start: string;
    let end: string;
    if (startParam || endParam) {
      if (!startParam || !DATE_RE.test(startParam) || !endParam || !DATE_RE.test(endParam)) {
        return NextResponse.json(
          { error: "start_date dan end_date wajib berformat YYYY-MM-DD" },
          { status: 400 }
        );
      }
      start = startParam;
      end = endParam;
    } else {
      const year = yearParam && YEAR_RE.test(yearParam) ? yearParam : String(new Date().getFullYear());
      start = `${year}-01-01`;
      end = `${year}-12-31`;
    }

    // Draft hanya untuk HR — karyawan tidak boleh melihat tanggal yang belum pasti.
    const includeDraft =
      params.get("include_draft") === "1" &&
      (HR_ROLES as readonly string[]).includes(user.role);

    const rows = await query<HolidayApiRow>(
      `SELECT ${SELECT_COLUMNS}
       FROM hris.public_holidays
       WHERE deleted_at IS NULL
         AND holiday_date BETWEEN $1::date AND $2::date
         AND ($3::boolean OR status = 'aktif')
       ORDER BY holiday_date ASC, name ASC`,
      [start, end, includeDraft]
    );

    return NextResponse.json({ data: rows, meta: { start_date: start, end_date: end } });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[holidays] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

interface HolidayBody {
  holiday_date?: string;
  name?: string;
  type?: string;
  deducts_leave?: boolean;
  status?: string;
  note?: string | null;
}

export function validateHolidayBody(body: HolidayBody): string | null {
  if (!body.holiday_date || !DATE_RE.test(body.holiday_date)) {
    return "Tanggal wajib diisi (YYYY-MM-DD)";
  }
  if (Number.isNaN(new Date(`${body.holiday_date}T00:00:00Z`).getTime())) {
    return "Tanggal tidak valid";
  }
  if (!body.name?.trim()) return "Nama libur wajib diisi";
  if (body.type !== undefined && !HOLIDAY_TYPES.includes(body.type as HolidayType)) {
    return "Tipe libur tidak valid";
  }
  if (body.status !== undefined && !["draft", "aktif"].includes(body.status)) {
    return "Status tidak valid";
  }
  return null;
}

/**
 * Cuti bersama memotong jatah cuti tahunan menurut SKB; libur nasional tidak.
 * Default mengikuti tipe supaya HRD tidak perlu menghafal aturannya, tetapi
 * tetap bisa ditimpa eksplisit dari form.
 */
export function defaultDeductsLeave(type: HolidayType): boolean {
  return type === "cuti_bersama";
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireIamMenuPrefix(IAM.hrisKepegawaian);
    const body = (await req.json()) as HolidayBody;

    const invalid = validateHolidayBody(body);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

    const type = (body.type as HolidayType | undefined) ?? "nasional";
    const created = await queryOne<HolidayApiRow>(
      `INSERT INTO hris.public_holidays
         (holiday_date, name, type, deducts_leave, status, source, note, created_by, updated_by)
       VALUES ($1::date, $2, $3, $4, $5, 'manual', $6, $7, $7)
       RETURNING ${SELECT_COLUMNS}`,
      [
        body.holiday_date,
        body.name!.trim(),
        type,
        body.deducts_leave ?? defaultDeductsLeave(type),
        body.status ?? "aktif",
        body.note?.trim() || null,
        user.id,
      ]
    );

    return NextResponse.json(
      { data: created, message: `Libur "${created?.name}" ditambahkan` },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if ((error as { code?: string })?.code === UNIQUE_VIOLATION) {
      return NextResponse.json(
        { error: "Libur dengan tanggal dan nama yang sama sudah ada" },
        { status: 409 }
      );
    }
    console.error("[holidays] POST failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
