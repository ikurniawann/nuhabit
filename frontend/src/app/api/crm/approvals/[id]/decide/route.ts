import { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, requireApiUser, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { decideApproval, emitApprovalDecisionEvent } from "@/lib/crm/approvals-server";

const schema = z.object({
  decision: z.enum(["approve", "reject"]),
  comment: z.string().trim().max(1000).optional().nullable(),
});

function decisionMessage(status: "pending" | "approved" | "rejected", nextLevel: number | null) {
  if (status === "approved") return "Disetujui — quotation boleh dikirim";
  if (status === "rejected") return "Ditolak";
  return `Disetujui tingkat ini — lanjut ke tingkat ${nextLevel}`;
}

/** Keputusan approver pada tingkat berjalan. */
export const POST = apiHandler(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireApiUser();
  const { id } = await params;
  const { decision, comment } = await validateBody(request, schema);
  const result = await decideApproval(id, decision, comment ?? null, { id: user.id, role: user.role });
  if (!result.ok) throw new ApiError(result.code, result.error);
  await emitApprovalDecisionEvent(id, user.id, { approval: result.status, decision });
  return successResponse(result, decisionMessage(result.status, result.next_level));
}, "crm.approvals.[id].decide.POST");
