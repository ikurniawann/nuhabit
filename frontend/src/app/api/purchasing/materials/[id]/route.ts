// /api/purchasing/materials/:id — alias lama ke item.raw_materials (guard IAM items).
import { NextRequest } from "next/server";
import {
  noContentResponse,
  requireIamMenuPrefix,
  successResponse,
} from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { parseBodyOrThrow } from "@/lib/purchasing/pr-schemas";
import {
  getLegacyMaterial,
  legacyMaterialUpdateSchema,
  softDeleteLegacyMaterial,
  updateLegacyMaterial,
} from "@/lib/purchasing/raw-material-api-legacy";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  return successResponse(await getLegacyMaterial(await createServerPgClient(), id));
}, "purchasing.materials.detail");

export const PUT = apiHandler(async (request: NextRequest, { params }: RouteContext) => {
  const user = await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  const db = await createServerPgClient();
  const input = parseBodyOrThrow(legacyMaterialUpdateSchema, await request.json());
  const data = await updateLegacyMaterial(db, id, user.id, input);
  return successResponse(data, "Bahan baku berhasil diperbarui");
}, "purchasing.materials.update");

export const DELETE = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  const user = await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  await softDeleteLegacyMaterial(await createServerPgClient(), id, user.id);
  return noContentResponse();
}, "purchasing.materials.delete");
