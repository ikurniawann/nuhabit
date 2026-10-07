import { NextRequest } from "next/server";
import { noContentResponse, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { assertRuleAccess, deleteRule, updateScoringRule } from "@/lib/crm/advance-rules-server";
import { requireCrmScope } from "@/lib/crm/guards";
import { patchSchemaOf } from "@/lib/crm/patch-schema";
import { scoringRuleSchema } from "@/lib/crm/scoring";

type Ctx = { params: Promise<{ id: string }> };
const NOT_FOUND = "Aturan tidak ditemukan";

export const PATCH = apiHandler(async (request: NextRequest, { params }: Ctx) => {
  const { user, scope } = await requireCrmScope("settings");
  const { id } = await params;
  await assertRuleAccess("crm_scoring_rules", id, user, scope, NOT_FOUND);
  const patch = await validateBody(request, patchSchemaOf(scoringRuleSchema));
  return successResponse(await updateScoringRule(id, patch), "Aturan diperbarui");
}, "crm.scoring-rules.[id].PATCH");

export const DELETE = apiHandler(async (_request: NextRequest, { params }: Ctx) => {
  const { user, scope } = await requireCrmScope("settings");
  const { id } = await params;
  await assertRuleAccess("crm_scoring_rules", id, user, scope, NOT_FOUND);
  await deleteRule("crm_scoring_rules", id);
  return noContentResponse();
}, "crm.scoring-rules.[id].DELETE");
