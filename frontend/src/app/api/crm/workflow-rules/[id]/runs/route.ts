import { NextRequest } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { assertRuleAccess, listWorkflowRuleRuns } from "@/lib/crm/advance-rules-server";
import { requireCrmScope } from "@/lib/crm/guards";

/** Log eksekusi satu rule (50 terakhir) + aksi terjadwal yang masih menunggu. */
export const GET = apiHandler(async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { user, scope } = await requireCrmScope("settings");
  const { id } = await params;
  await assertRuleAccess("crm_workflow_rules", id, user, scope, "Rule tidak ditemukan");
  return successResponse(await listWorkflowRuleRuns(id));
}, "crm.workflow-rules.[id].runs.GET");
