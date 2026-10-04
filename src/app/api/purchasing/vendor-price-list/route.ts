import { NextRequest, NextResponse } from "next/server";
import { createdResponse, requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope } from "@/lib/api/scope";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { parseBodyOrThrow } from "@/lib/purchasing/pr-schemas";
import {
  createPriceList,
  listPriceLists,
  priceListCreateSchema,
  priceListQuerySchema,
} from "@/lib/purchasing/vendor-price-list";

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);
  const params = parseBodyOrThrow(
    priceListQuerySchema,
    Object.fromEntries(new URL(request.url).searchParams)
  );
  const db = await createServerPgClient();
  return NextResponse.json(await listPriceLists(db, params, await getApiUserScope()));
}, "purchasing.vendor-price-list.list");

export const POST = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);
  const db = await createServerPgClient();
  const input = await validateBody(request, priceListCreateSchema);
  const data = await createPriceList(db, input, await getApiUserScope());
  return createdResponse(data, "Price list created successfully");
}, "purchasing.vendor-price-list.create");
