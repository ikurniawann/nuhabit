import { NextRequest } from "next/server";
import { requireIamMenuPrefix, successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope } from "@/lib/api/scope";
import { listApprovalInbox } from "@/lib/crm/approvals-server";
import { IAM } from "@/lib/iam/prefixes";

/**
 * EPIC-050 T-2.4 — inbox approval. view=mine (default) | all (bukan untuk sales);
 * status=pending (default) | approved | rejected | all.
 */
export const GET = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.salesFunnel);
  const scope = await getApiUserScope();
  const searchParams = request.nextUrl.searchParams;
  const view = searchParams.get("view") === "all" && user.role !== "sales" ? "all" : "mine";
  const status = searchParams.get("status") ?? "pending";
  return successResponse(await listApprovalInbox(user, scope, { view, status }));
}, "crm.approvals.GET");
