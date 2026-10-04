import { NextRequest } from "next/server";
import { createdResponse, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { createScoringRule, listScoringRules } from "@/lib/crm/advance-rules-server";
import { requireCrmScope } from "@/lib/crm/guards";
import { scoringRuleSchema } from "@/lib/crm/scoring";

/** EPIC-050 T-2.2 — aturan lead scoring. */
export const GET = apiHandler(async () => {
  const { scope } = await requireCrmScope("settings");
  return successResponse(await listScoringRules(scope));
}, "crm.scoring-rules.GET");

export const POST = apiHandler(async (request: NextRequest) => {
  const { user, scope } = await requireCrmScope("settings");
  const body = await validateBody(request, scoringRuleSchema);
  return createdResponse(await createScoringRule(user, scope, body), "Aturan scoring dibuat");
}, "crm.scoring-rules.POST");
