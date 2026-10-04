// /api/purchasing/units/:id — detail, ubah, hapus (soft).
import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { parseBodyOrThrow } from "@/lib/purchasing/pr-schemas";
import { getUnit, softDeleteUnit, unitUpdateSchema, updateUnit } from "@/lib/purchasing/unit-api";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  const data = await getUnit(await createServerPgClient(), id);
  return NextResponse.json({ success: true, data });
}, "purchasing.units.detail");

export const PUT = apiHandler(async (request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  const db = await createServerPgClient();
  const input = parseBodyOrThrow(unitUpdateSchema, await request.json());
  const data = await updateUnit(db, id, input);
  return NextResponse.json({ success: true, data, message: "Satuan berhasil diupdate" });
}, "purchasing.units.update");

export const DELETE = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  await softDeleteUnit(await createServerPgClient(), id);
  return NextResponse.json({ success: true, message: "Satuan berhasil dihapus" });
}, "purchasing.units.delete");
