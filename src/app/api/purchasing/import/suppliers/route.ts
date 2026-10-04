import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope, importBusinessIds } from "@/lib/api/scope";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { readUploadedSheet } from "@/lib/purchasing/import-lookups";
import { importSuppliers } from "@/lib/purchasing/import-suppliers";
import { normalizeSupplierSpreadsheetHeader } from "@/lib/purchasing/supplier-spreadsheet";

// POST /api/purchasing/import/suppliers — form-data `file` (CSV/XLSX)
export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.items);
  const { companyId, branchId } = importBusinessIds(await getApiUserScope());
  const rows = await readUploadedSheet(request, normalizeSupplierSpreadsheetHeader);

  const result = await importSuppliers(await createServerPgClient(), rows, {
    userId: user.id,
    companyId,
    branchId,
  });
  return NextResponse.json(result);
}, "purchasing.import.suppliers");
