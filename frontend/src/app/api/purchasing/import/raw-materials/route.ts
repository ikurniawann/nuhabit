import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope, importBusinessIds } from "@/lib/api/scope";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { readUploadedSheet } from "@/lib/purchasing/import-lookups";
import { importRawMaterials } from "@/lib/purchasing/import-raw-materials";
import { normalizeSpreadsheetHeader } from "@/lib/purchasing/raw-material-spreadsheet";

// POST /api/purchasing/import/raw-materials — form-data `file` (CSV/XLSX)
export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.items);
  const { companyId, branchId } = importBusinessIds(await getApiUserScope());
  const rows = await readUploadedSheet(request, normalizeSpreadsheetHeader);

  const result = await importRawMaterials(await createServerPgClient(), rows, {
    userId: user.id,
    companyId,
    branchId,
  });
  return NextResponse.json(result);
}, "purchasing.import.raw-materials");
