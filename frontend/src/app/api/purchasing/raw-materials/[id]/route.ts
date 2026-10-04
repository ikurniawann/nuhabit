// /api/purchasing/raw-materials/:id — detail, update (PUT/PATCH), soft delete.
import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope } from "@/lib/api/scope";
import { rawMaterialStockSource } from "@/lib/api/stall-scope";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { parseBodyOrThrow } from "@/lib/purchasing/pr-schemas";
import {
  deleteRawMaterial,
  getRawMaterialDetail,
  updateRawMaterial,
} from "@/lib/purchasing/raw-material-api";
import {
  prepareMaterialBody,
  rawMaterialUpdateSchema,
} from "@/lib/purchasing/raw-material-api-rules";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  const db = await createServerPgClient();
  const scope = await getApiUserScope();
  const data = await getRawMaterialDetail(db, scope, await rawMaterialStockSource(), id);
  return NextResponse.json({ success: true, data });
}, "purchasing.raw-materials.detail");

export const PUT = apiHandler(async (request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  const db = await createServerPgClient();
  const input = parseBodyOrThrow(
    rawMaterialUpdateSchema,
    prepareMaterialBody(await request.json())
  );
  const data = await updateRawMaterial(db, id, input);
  return NextResponse.json({ success: true, data, message: "Bahan baku berhasil diupdate" });
}, "purchasing.raw-materials.update");

export const PATCH = PUT;

export const DELETE = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  await deleteRawMaterial(await createServerPgClient(), id);
  return NextResponse.json({ success: true, message: "Bahan baku berhasil dihapus" });
}, "purchasing.raw-materials.delete");
