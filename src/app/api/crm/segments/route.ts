import { NextRequest } from "next/server";
import { createdResponse, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { requireCrmScope } from "@/lib/crm/guards";
import { segmentSchema } from "@/lib/crm/segments";
import { createSegment, listSegments } from "@/lib/crm/segments-server";

/** EPIC-050 T-5.1 — daftar & buat segmen dinamis. */
export const GET = apiHandler(async () => {
  const { scope } = await requireCrmScope("segments");
  return successResponse(await listSegments(scope));
}, "crm.segments.GET");

export const POST = apiHandler(async (request: NextRequest) => {
  const { user, scope } = await requireCrmScope("segments");
  const body = await validateBody(request, segmentSchema);
  return createdResponse(await createSegment(user, scope, body), "Segmen dibuat");
}, "crm.segments.POST");
