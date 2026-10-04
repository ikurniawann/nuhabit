import { NextRequest } from "next/server";
import { noContentResponse, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { requireCrmScope } from "@/lib/crm/guards";
import { patchSchemaOf } from "@/lib/crm/patch-schema";
import { segmentSchema } from "@/lib/crm/segments";
import { deleteSegment, requireSegment, updateSegment } from "@/lib/crm/segments-server";

type Ctx = { params: Promise<{ id: string }> };

export const GET = apiHandler(async (_request: NextRequest, { params }: Ctx) => {
  const { scope } = await requireCrmScope("segments");
  const { id } = await params;
  return successResponse(await requireSegment(id, scope));
}, "crm.segments.[id].GET");

export const PATCH = apiHandler(async (request: NextRequest, { params }: Ctx) => {
  const { scope } = await requireCrmScope("segments");
  const { id } = await params;
  await requireSegment(id, scope);
  const patch = await validateBody(request, patchSchemaOf(segmentSchema));
  return successResponse(await updateSegment(id, patch), "Segmen diperbarui");
}, "crm.segments.[id].PATCH");

export const DELETE = apiHandler(async (_request: NextRequest, { params }: Ctx) => {
  const { scope } = await requireCrmScope("segments");
  const { id } = await params;
  await requireSegment(id, scope);
  await deleteSegment(id);
  return noContentResponse();
}, "crm.segments.[id].DELETE");
