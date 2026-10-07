// /api/purchasing/units — daftar & tambah satuan.
import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope } from "@/lib/api/scope";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { parseBodyOrThrow } from "@/lib/purchasing/pr-schemas";
import { createUnit, listUnits, unitCreateSchema } from "@/lib/purchasing/unit-api";

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);
  const db = await createServerPgClient();
  const scope = await getApiUserScope();
  const sp = new URL(request.url).searchParams;
  const result = await listUnits(db, scope, {
    search: sp.get("search"),
    isActive: sp.get("is_active"),
    page: parseInt(sp.get("page") || "1"),
    limit: parseInt(sp.get("limit") || "20"),
  });
  return NextResponse.json(result);
}, "purchasing.units.list");

export const POST = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);
  const db = await createServerPgClient();
  const scope = await getApiUserScope();
  const input = parseBodyOrThrow(unitCreateSchema, await request.json());
  const data = await createUnit(db, scope, input);
  return NextResponse.json({ data }, { status: 201 });
}, "purchasing.units.create");
