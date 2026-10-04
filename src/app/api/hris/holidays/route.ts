import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireApiUser, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createHoliday, listHolidays } from "@/lib/hris/holidays-db";
import {
  holidayBodySchema,
  resolveHolidayRange,
  validateHolidayBody,
} from "@/lib/hris/holidays-input";
import { HR_ROLES } from "@/lib/hris/workforce-auth";
import { readJson } from "@/lib/hris/workforce-route";

/**
 * GET  /api/hris/holidays — hari libur pada satu rentang/tahun. Terbuka untuk
 *      semua akun login (kalender ESS butuh tanggal merah). Baris `draft`
 *      hanya untuk role HR lewat include_draft=1.
 * POST /api/hris/holidays — tambah hari libur (menu kepegawaian): angka di
 *      sini menyetir potongan jatah cuti.
 */

export const GET = apiHandler(async (req: NextRequest) => {
  const user = await requireApiUser();
  const params = req.nextUrl.searchParams;
  const range = resolveHolidayRange(params);
  if (!range) throw ApiError.badRequest("start_date dan end_date wajib berformat YYYY-MM-DD");

  // Draft hanya untuk HR: karyawan tidak boleh melihat tanggal yang belum pasti.
  const includeDraft =
    params.get("include_draft") === "1" && (HR_ROLES as readonly string[]).includes(user.role);
  const rows = await listHolidays(range.start, range.end, includeDraft);
  return NextResponse.json({ data: rows, meta: { start_date: range.start, end_date: range.end } });
}, "hris/holidays GET");

export const POST = apiHandler(async (req: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.hrisKepegawaian);
  const body = await readJson(req, holidayBodySchema);
  const invalid = validateHolidayBody(body);
  if (invalid) throw ApiError.badRequest(invalid);

  const created = await createHoliday(body, user.id);
  return NextResponse.json(
    { data: created, message: `Libur "${created?.name}" ditambahkan` },
    { status: 201 }
  );
}, "hris/holidays POST");
