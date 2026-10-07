import { NextRequest } from "next/server";
import { successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { requireCrmScope } from "@/lib/crm/guards";
import { segmentDefinitionSchema } from "@/lib/crm/segments";
import { previewSegment } from "@/lib/crm/segments-server";

/** EPIC-050 T-5.1 — pratinjau definisi ad-hoc (jumlah + contoh anggota). */
export const POST = apiHandler(async (request: NextRequest) => {
  const { scope } = await requireCrmScope("segments");
  const definition = await validateBody(request, segmentDefinitionSchema);
  return successResponse(await previewSegment(definition, scope));
}, "crm.segments.preview.POST");
