import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { promoteCandidate, promotionSchema } from "@/lib/hris/promote-candidate";
import { readJson } from "@/lib/hris/workforce-route";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";

/**
 * POST /api/hris/promote: kandidat hired/talent pool menjadi karyawan,
 * plus draft kontrak otomatis dari offer yang diterima.
 * Body: { candidate_id, join_date?, employment_status?, department_id?, reporting_to? }
 */
export const POST = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.hrisRecruitment);
  const input = await readJson(request, promotionSchema);
  return NextResponse.json(await promoteCandidate(await createServerPgClient(), input));
}, "hris/promote.POST");
