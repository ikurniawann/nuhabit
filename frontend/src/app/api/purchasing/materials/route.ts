// /api/purchasing/materials — alias lama ke item.raw_materials (guard IAM items).
import { NextRequest } from "next/server";
import {
  paginatedResponse,
  requireIamMenuPrefix,
  successResponse,
} from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope } from "@/lib/api/scope";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { parseBodyOrThrow } from "@/lib/purchasing/pr-schemas";
import {
  createLegacyMaterial,
  legacyMaterialListQuerySchema,
  listLegacyMaterials,
  type LegacyMaterialCreateBody,
} from "@/lib/purchasing/raw-material-api-legacy";

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);
  const db = await createServerPgClient();
  const params = parseBodyOrThrow(
    legacyMaterialListQuerySchema,
    Object.fromEntries(new URL(request.url).searchParams)
  );
  const { rows, meta } = await listLegacyMaterials(db, await getApiUserScope(), params);
  return paginatedResponse(rows, meta);
}, "purchasing.materials.list");

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.items);
  const db = await createServerPgClient();
  const body = (await request.json()) as LegacyMaterialCreateBody;
  const data = await createLegacyMaterial(db, await getApiUserScope(), user.id, body);
  return successResponse(data, "Bahan baku berhasil dibuat");
}, "purchasing.materials.create");
