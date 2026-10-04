import { NextRequest } from "next/server";
import { createdResponse, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { createWorkflowRule, listWorkflowRules } from "@/lib/crm/advance-rules-server";
import { requireCrmScope } from "@/lib/crm/guards";
import { workflowRuleSchema } from "@/lib/crm/workflow";

/** EPIC-050 T-2.3 — workflow rules. */
export const GET = apiHandler(async () => {
  const { scope } = await requireCrmScope("settings");
  return successResponse(await listWorkflowRules(scope));
}, "crm.workflow-rules.GET");

export const POST = apiHandler(async (request: NextRequest) => {
  const { user, scope } = await requireCrmScope("settings");
  const body = await validateBody(request, workflowRuleSchema);
  return createdResponse(await createWorkflowRule(user, scope, body), "Workflow rule dibuat");
}, "crm.workflow-rules.POST");
