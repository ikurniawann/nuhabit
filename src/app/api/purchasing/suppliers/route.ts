import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope } from "@/lib/api/scope";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { parseBodyOrThrow } from "@/lib/purchasing/pr-schemas";
import {
  createSupplier,
  listSuppliers,
  supplierCreateSchema,
  supplierListQuerySchema,
} from "@/lib/purchasing/supplier-service";

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);
  const params = parseBodyOrThrow(
    supplierListQuerySchema,
    Object.fromEntries(new URL(request.url).searchParams)
  );
  const db = await createServerPgClient();
  // Format tanpa wrapper success (dibaca listSuppliers di klien).
  return NextResponse.json(await listSuppliers(db, params, await getApiUserScope()));
}, "purchasing.suppliers.list");

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.items);
  const input = await validateBody(request, supplierCreateSchema);
  const db = await createServerPgClient();
  const data = await createSupplier(db, input, user.id, await getApiUserScope());
  return NextResponse.json({ data }, { status: 201 });
}, "purchasing.suppliers.create");
