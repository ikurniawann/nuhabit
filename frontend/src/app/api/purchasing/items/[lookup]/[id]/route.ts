// /api/purchasing/items/:lookup/:id — ubah & hapus (soft) master kategori item.
import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import {
  requireItemsLookupConfig,
  softDeleteItemsLookup,
  updateItemsLookup,
} from "@/lib/purchasing/item-lookup-api";
import { itemsLookupSchema } from "@/lib/purchasing/items-lookup";
import { parseBodyOrThrow } from "@/lib/purchasing/pr-schemas";

type RouteContext = { params: Promise<{ lookup: string; id: string }> };

export const PUT = apiHandler(async (request: NextRequest, context: RouteContext) => {
  await requireIamMenuPrefix(IAM.items);
  const { lookup, id } = await context.params;
  const config = requireItemsLookupConfig(lookup);
  const db = await createServerPgClient();
  const input = parseBodyOrThrow(itemsLookupSchema, await request.json());
  const data = await updateItemsLookup(db, config, id, input);
  return NextResponse.json({ data, message: "Berhasil diperbarui" });
}, "purchasing.items-lookup.update");

export const DELETE = apiHandler(async (_request: NextRequest, context: RouteContext) => {
  await requireIamMenuPrefix(IAM.items);
  const { lookup, id } = await context.params;
  const config = requireItemsLookupConfig(lookup);
  await softDeleteItemsLookup(await createServerPgClient(), config, id);
  return NextResponse.json({ message: "Berhasil dihapus" });
}, "purchasing.items-lookup.delete");
