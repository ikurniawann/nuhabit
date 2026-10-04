import { NextRequest } from "next/server";
import { ApiError, noContentResponse, successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import {
  assertRuleAccess,
  deleteRule,
  getWorkflowRule,
  replaceWorkflowRule,
  setWorkflowRuleActive,
} from "@/lib/crm/advance-rules-server";
import { requireCrmScope } from "@/lib/crm/guards";
import { workflowRuleSchema } from "@/lib/crm/workflow";

type Ctx = { params: Promise<{ id: string }> };

async function accessibleRule({ params }: Ctx) {
  const { user, scope } = await requireCrmScope("settings");
  const { id } = await params;
  await assertRuleAccess("crm_workflow_rules", id, user, scope, "Rule tidak ditemukan");
  return id;
}

export const GET = apiHandler(async (_request: NextRequest, ctx: Ctx) => {
  const id = await accessibleRule(ctx);
  return successResponse(await getWorkflowRule(id));
}, "crm.workflow-rules.[id].GET");

export const PATCH = apiHandler(async (request: NextRequest, ctx: Ctx) => {
  const id = await accessibleRule(ctx);
  const body = await request.json();
  // toggle cepat (is_active saja) tidak perlu validasi penuh
  const keys = Object.keys(body ?? {});
  if (keys.length === 1 && keys[0] === "is_active" && typeof body.is_active === "boolean") {
    const row = await setWorkflowRuleActive(id, body.is_active);
    return successResponse(row, body.is_active ? "Rule diaktifkan" : "Rule dinonaktifkan");
  }
  const parsed = workflowRuleSchema.safeParse(body);
  if (!parsed.success) throw ApiError.badRequest("Validation failed", parsed.error.issues);
  return successResponse(await replaceWorkflowRule(id, parsed.data), "Workflow rule diperbarui");
}, "crm.workflow-rules.[id].PATCH");

export const DELETE = apiHandler(async (_request: NextRequest, ctx: Ctx) => {
  const id = await accessibleRule(ctx);
  await deleteRule("crm_workflow_rules", id);
  return noContentResponse();
}, "crm.workflow-rules.[id].DELETE");
