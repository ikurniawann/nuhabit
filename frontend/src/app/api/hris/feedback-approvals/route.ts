import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import {
  decideAssignments,
  listApprovals,
  paginationMeta,
  parsePagination,
  requireApproverEmployeeId,
} from "@/lib/hris/feedback-repo";
import { readJson } from "@/lib/hris/workforce-route";

// Modul 360 feedback belum punya UI; semua handler khusus pengelola kinerja.

/** GET /api/hris/feedback-approvals — self-assessment per status (default submitted). */
export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.hrisPerformanceAdmin);
  const params = request.nextUrl.searchParams;
  const pagination = parsePagination(params, 20);
  const { rows, total, stats } = await listApprovals(params.get("status") || "submitted", pagination);
  return NextResponse.json({ data: rows, stats, pagination: paginationMeta(pagination, total) });
}, "hris/feedback-approvals GET");

const bulkSchema = z.object({
  assignment_ids: z.array(z.guid(), { error: "assignment_ids is required" }).max(500),
  action: z.enum(["approve", "reject"], { error: 'Action must be "approve" or "reject"' }),
  comments: z.string().max(5000).nullable().optional(),
  rejection_reason: z.string().max(5000).optional(),
});

/** POST /api/hris/feedback-approvals — approve/reject massal. */
export const POST = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.hrisPerformanceAdmin);
  const body = await readJson(request, bulkSchema);
  const approverId = await requireApproverEmployeeId("User not found in employees table");
  const decision =
    body.action === "approve"
      ? { action: "approve" as const, comments: body.comments }
      : { action: "reject" as const, reason: body.rejection_reason ?? "" };
  const data = await decideAssignments(body.assignment_ids, decision, approverId);
  return NextResponse.json({
    success: true,
    data,
    message: `Successfully ${body.action}d ${data?.length || 0} submission(s)`,
  });
}, "hris/feedback-approvals POST");
