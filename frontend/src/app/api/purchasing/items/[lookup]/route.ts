// /api/purchasing/items/:lookup — daftar & tambah master kategori item.
import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import {
  createItemsLookup,
  listItemsLookup,
  requireItemsLookupConfig,
} from "@/lib/purchasing/item-lookup-api";
import { itemsLookupSchema } from "@/lib/purchasing/items-lookup";
import { parseBodyOrThrow } from "@/lib/purchasing/pr-schemas";

type RouteContext = { params: Promise<{ lookup: string }> };

export const GET = apiHandler(async (request: NextRequest, context: RouteContext) => {
  await requireIamMenuPrefix(IAM.items);
  const config = requireItemsLookupConfig((await context.params).lookup);
  const db = await createServerPgClient();
  const sp = new URL(request.url).searchParams;
  const result = await listItemsLookup(db, config, {
    search: sp.get("search"),
    page: parseInt(sp.get("page") || "1", 10),
    limit: parseInt(sp.get("limit") || "50", 10),
  });
  return NextResponse.json(result);
}, "purchasing.items-lookup.list");

export const POST = apiHandler(async (request: NextRequest, context: RouteContext) => {
  await requireIamMenuPrefix(IAM.items);
  const config = requireItemsLookupConfig((await context.params).lookup);
  const db = await createServerPgClient();
  const input = parseBodyOrThrow(itemsLookupSchema, await request.json());
  const data = await createItemsLookup(db, config, input);
  return NextResponse.json({ data, message: "Berhasil ditambahkan" }, { status: 201 });
}, "purchasing.items-lookup.create");
