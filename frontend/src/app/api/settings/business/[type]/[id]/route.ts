import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import {
  deleteBusinessEntity,
  fetchBusinessTree,
  updateBusinessEntity,
} from "@/lib/configuration/business-repository";
import { parseBusinessEntityType } from "@/lib/settings/business-entity";
import { rethrowUserFacing } from "@/lib/settings/route-errors";

type RouteContext = { params: Promise<{ type: string; id: string }> };

const updateSchema = z.object({
  name: z.string().optional(),
  code: z.string().optional(),
  is_active: z.boolean().optional(),
});

export const PATCH = apiHandler(async (request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.settingsBusiness);
  const { type, id } = await params;
  const entityType = parseBusinessEntityType(type);
  const body = await validateBody(request, updateSchema);
  await updateBusinessEntity(entityType, id, body).catch(rethrowUserFacing(/Tidak ada data/));
  return NextResponse.json({ data: { id }, tree: await fetchBusinessTree() });
}, "PATCH /api/settings/business/[type]/[id]");

export const DELETE = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.settingsBusiness);
  const { type, id } = await params;
  await deleteBusinessEntity(parseBusinessEntityType(type), id).catch(
    rethrowUserFacing(/tidak dapat|tidak ditemukan/)
  );
  return NextResponse.json({ data: { id }, tree: await fetchBusinessTree() });
}, "DELETE /api/settings/business/[type]/[id]");
