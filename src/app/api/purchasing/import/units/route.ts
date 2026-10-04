import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import {
  createHeaderNormalizer,
  ImportTally,
  matrixToRows,
  parseCsvMatrix,
} from "@/lib/purchasing/import-spreadsheet";

const normalizeHeader = createHeaderNormalizer({});

/** Kolom units dari satu baris CSV; hanya status "active" yang aktif. */
function buildUnitPayload(data: Record<string, string>) {
  return {
    kode: data.kode,
    nama: data.nama,
    tipe: data.tipe || null,
    faktor_konversi: parseFloat(data.faktor_konversi) || 1,
    satuan_induk: data.satuan_induk || null,
    deskripsi: data.deskripsi || null,
    is_active: data.status?.toLowerCase() === "active",
  };
}

// POST /api/purchasing/import/units — CSV saja; kode yang sudah ada dilewati.
export const POST = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);
  const file = (await request.formData()).get("file");
  if (!(file instanceof File)) throw ApiError.badRequest("File tidak ditemukan");

  const matrix = parseCsvMatrix(await file.text());
  if (matrix.length < 2) throw ApiError.badRequest("File CSV harus memiliki header dan minimal 1 data");

  const db = await createServerPgClient();
  const tally = new ImportTally();

  for (const { rowNumber, data } of matrixToRows(matrix, normalizeHeader)) {
    const missing = ["kode", "nama"].filter((field) => !data[field]?.trim());
    if (missing.length > 0) {
      tally.skip(rowNumber, `Field wajib kosong: ${missing.join(", ")}`);
      continue;
    }

    const { data: existing } = await db.from("units").select("id").eq("kode", data.kode).single();
    if (existing) {
      tally.skip(rowNumber, `Kode satuan ${data.kode} sudah ada`);
      continue;
    }

    const { error } = await db.from("units").insert(buildUnitPayload(data));
    if (error) tally.skip(rowNumber, error.message);
    else tally.imported += 1;
  }

  return NextResponse.json({
    success: true,
    imported: tally.imported,
    skipped: tally.skipped,
    errors: tally.errors,
  });
}, "purchasing.import.units");
