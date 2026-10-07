import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { decideAssignment, requireApproverEmployeeId } from "@/lib/hris/feedback-repo";
import { readJson } from "@/lib/hris/workforce-route";

// Modul 360 feedback belum punya UI; semua handler khusus pengelola kinerja.

const schema = z.object({
  assignment_id: z.guid({ error: "assignment_id is required" }),
  manager_comments: z.string().max(5000).nullable().optional(),
});

/** POST /api/hris/feedback-approvals/approve */
export const POST = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.hrisPerformanceAdmin);
  const body = await readJson(request, schema);
  const approverId = await requireApproverEmployeeId("No valid employee found for approval");
  const data = await decideAssignment(
    body.assignment_id,
    { action: "approve", comments: body.manager_comments || null },
    approverId
  );
  return NextResponse.json({ success: true, data, message: "Feedback approved successfully" });
}, "hris/feedback-approvals/approve POST");
