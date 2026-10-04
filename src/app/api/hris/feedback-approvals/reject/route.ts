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
  rejection_reason: z
    .string({ error: "Rejection reason is required" })
    .trim()
    .min(1, "Rejection reason is required")
    .max(5000),
});

/** POST /api/hris/feedback-approvals/reject */
export const POST = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.hrisPerformanceAdmin);
  const body = await readJson(request, schema);
  const approverId = await requireApproverEmployeeId("No valid employee found for rejection");
  const data = await decideAssignment(
    body.assignment_id,
    { action: "reject", reason: body.rejection_reason },
    approverId
  );
  return NextResponse.json({
    success: true,
    data,
    message: "Feedback rejected. Employee has been notified.",
  });
}, "hris/feedback-approvals/reject POST");
