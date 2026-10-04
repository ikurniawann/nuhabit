// /api/purchasing/supply-items/:id — EPIC-026 B1 detail / update / soft delete.
// Baris di luar scope user → 404.
import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope } from "@/lib/api/scope";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { parseBodyOrThrow } from "@/lib/purchasing/pr-schemas";
import {
  buildSupplyItemPatch,
  getSupplyItemInScope,
  softDeleteSupplyItem,
  supplyItemUpdateSchema,
  updateSupplyItem,
} from "@/lib/purchasing/supply-items-api";

type RouteContext = { params: Promise<{ id: string }> };

async function loadInScope(context: RouteContext) {
  const { id } = await context.params;
  const db = await createServerPgClient();
  const scope = await getApiUserScope();
  await getSupplyItemInScope(db, scope, id);
  return { id, db, userId: scope?.userId ?? null };
}

export const GET = apiHandler(async (_request: NextRequest, context: RouteContext) => {
  await requireIamMenuPrefix(IAM.items);
  const { id } = await context.params;
  const data = await getSupplyItemInScope(
    await createServerPgClient(),
    await getApiUserScope(),
    id
  );
  return NextResponse.json({ success: true, data });
}, "purchasing.supply-items.detail");

export const PATCH = apiHandler(async (request: NextRequest, context: RouteContext) => {
  await requireIamMenuPrefix(IAM.items);
  const { id, db, userId } = await loadInScope(context);
  const input = parseBodyOrThrow(supplyItemUpdateSchema, await request.json());
  const data = await updateSupplyItem(db, id, buildSupplyItemPatch(input, userId));
  return NextResponse.json({ success: true, data });
}, "purchasing.supply-items.update");

export const DELETE = apiHandler(async (_request: NextRequest, context: RouteContext) => {
  await requireIamMenuPrefix(IAM.items);
  const { id, db, userId } = await loadInScope(context);
  await softDeleteSupplyItem(db, id, userId);
  return NextResponse.json({ success: true });
}, "purchasing.supply-items.delete");
