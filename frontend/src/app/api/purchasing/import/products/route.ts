import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope, importBusinessIds } from "@/lib/api/scope";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { readUploadedSheet } from "@/lib/purchasing/import-lookups";
import { importProducts } from "@/lib/purchasing/import-products";
import { normalizeProductSpreadsheetHeader } from "@/lib/purchasing/product-spreadsheet";

// POST /api/purchasing/import/products — form-data `file` (CSV/XLSX)
export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.items);
  const scope = await getApiUserScope();
  const rows = await readUploadedSheet(request, normalizeProductSpreadsheetHeader);

  const result = await importProducts(await createServerPgClient(), rows, {
    userId: user.id,
    scope,
    branchFilter: importBusinessIds(scope).branchId,
  });
  return NextResponse.json(result);
}, "purchasing.import.products");
