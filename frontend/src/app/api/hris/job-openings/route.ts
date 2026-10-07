import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamGuard } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import {
  createJobOpening,
  jobOpeningBodySchema,
  listJobOpenings,
  normalizeJobOpening,
  validateJobOpening,
} from "@/lib/hris/job-openings";
import { readJson } from "@/lib/hris/workforce-route";

export const GET = apiHandler(async () => {
  const guard = await requireIamGuard(IAM.hrisRecruitment);
  if (guard.error) return guard.error;
  return NextResponse.json({ data: await listJobOpenings() });
}, "hris/job-openings GET");

export const POST = apiHandler(async (request: NextRequest) => {
  const guard = await requireIamGuard(IAM.hrisRecruitment);
  if (guard.error) return guard.error;
  const payload = normalizeJobOpening(await readJson(request, jobOpeningBodySchema), "create");
  const invalid = validateJobOpening(payload, "create");
  if (invalid) throw ApiError.badRequest(invalid);

  const data = await createJobOpening(payload);
  return NextResponse.json({ data, message: "Lowongan berhasil dibuat" }, { status: 201 });
}, "hris/job-openings POST");
