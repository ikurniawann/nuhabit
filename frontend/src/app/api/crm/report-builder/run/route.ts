import { NextRequest } from "next/server";
import { successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { requireCrmScope } from "@/lib/crm/guards";
import { reportDefinitionSchema } from "@/lib/crm/report-builder";
import { runReportDefinition } from "@/lib/crm/report-builder-server";

/** EPIC-050 T-4.1 — jalankan definisi ad-hoc (pratinjau builder). */
export const POST = apiHandler(async (request: NextRequest) => {
  const { user, scope } = await requireCrmScope("reports");
  const definition = await validateBody(request, reportDefinitionSchema);
  return successResponse(await runReportDefinition(definition, user, scope));
}, "crm.report-builder.run.POST");
