import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { importHolidays, previewHolidayImport } from "@/lib/hris/holidays-db";
import {
  holidayImportSchema,
  resolveImportYear,
  validateImportItem,
} from "@/lib/hris/holidays-input";
import { readJson } from "@/lib/hris/workforce-route";

/**
 * Impor kalender hari libur (EPIC-036 Fase E), sengaja dua langkah dan tanpa
 * cron: kalender sumber memuat tanggal yang bukan tanggal merah, dan daftar
 * resmi terbit lewat SKB 3 Menteri.
 *   GET  ?year=2026 — tarik ICS, kembalikan PREVIEW (tidak menulis apa pun).
 *   POST            — simpan baris yang dicentang HRD.
 */

export const GET = apiHandler(async (req: NextRequest) => {
  await requireIamMenuPrefix(IAM.hrisKepegawaian);
  const year = resolveImportYear(req.nextUrl.searchParams.get("year"));
  const data = await previewHolidayImport(year);
  return NextResponse.json({
    data,
    meta: {
      year,
      total: data.length,
      suggested: data.filter((row) => row.suggested).length,
      already_imported: data.filter((row) => row.already_imported).length,
    },
  });
}, "hris/holidays/import GET");

export const POST = apiHandler(async (req: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.hrisKepegawaian);
  const { items = [] } = await readJson(req, holidayImportSchema);
  if (items.length === 0) throw ApiError.badRequest("Tidak ada hari libur yang dicentang");
  for (const item of items) {
    const invalid = validateImportItem(item);
    if (invalid) {
      throw ApiError.badRequest(`${invalid}: ${item.name ?? item.holiday_date ?? "(tanpa nama)"}`);
    }
  }

  const result = await importHolidays(items, user.id);
  return NextResponse.json({
    data: result,
    message:
      `${result.created} hari libur ditambahkan` +
      (result.updated > 0 ? `, ${result.updated} diperbarui` : ""),
  });
}, "hris/holidays/import POST");
