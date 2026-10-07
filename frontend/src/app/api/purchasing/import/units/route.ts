import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope } from "@/lib/api/scope";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { createHeaderNormalizer, matrixToRows, parseCsvMatrix } from "@/lib/purchasing/import-spreadsheet";
import { importUnits } from "@/lib/purchasing/import-units";

const normalizeHeader = createHeaderNormalizer({});

// POST /api/purchasing/import/units — CSV saja; kode yang sudah ada di company dilewati.
export const POST = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);
  const file = (await request.formData()).get("file");
  if (!(file instanceof File)) throw ApiError.badRequest("File tidak ditemukan");

  const matrix = parseCsvMatrix(await file.text());
  if (matrix.length < 2) throw ApiError.badRequest("File CSV harus memiliki header dan minimal 1 data");

  const scope = await getApiUserScope();
  const result = await importUnits(await createServerPgClient(), matrixToRows(matrix, normalizeHeader), scope);
  return NextResponse.json(result);
}, "purchasing.import.units");
