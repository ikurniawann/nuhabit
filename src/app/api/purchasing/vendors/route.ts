import { NextRequest, NextResponse } from "next/server";
import { createdResponse, requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope } from "@/lib/api/scope";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { parseBodyOrThrow } from "@/lib/purchasing/pr-schemas";
import {
  createVendor,
  listVendors,
  vendorCreateSchema,
  vendorListQuerySchema,
} from "@/lib/purchasing/vendor-directory";

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);
  const params = parseBodyOrThrow(
    vendorListQuerySchema,
    Object.fromEntries(new URL(request.url).searchParams)
  );
  const db = await createServerPgClient();
  return NextResponse.json(await listVendors(db, params, await getApiUserScope()));
}, "purchasing.vendors.list");

export const POST = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);
  const input = await validateBody(request, vendorCreateSchema);
  const db = await createServerPgClient();
  const vendor = await createVendor(db, input, await getApiUserScope());
  return createdResponse(vendor, "Vendor created successfully");
}, "purchasing.vendors.create");
