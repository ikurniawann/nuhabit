import { NextResponse, type NextRequest } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { reviewTest } from "@/lib/recruitment/psikotes-admin";
import { assertUuid, enforceRateLimit } from "@/lib/recruitment/route-helpers";

/** PUT /api/psikotes/session-tests/[id]/review: review manual HR utk tes proyektif. */
export const PUT = apiHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireIamMenuPrefix(IAM.hrisRecruitment);
  const { id } = await params;
  assertUuid(id, "ID tes tidak valid");
  enforceRateLimit(`psikotes_review_put_${user.id}`);
  const saved = await reviewTest(id, req, user);
  return NextResponse.json({ data: saved, message: "Review tersimpan" });
}, "psikotes-review");
