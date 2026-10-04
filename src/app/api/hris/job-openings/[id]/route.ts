import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamGuard } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import {
  deleteJobOpening,
  jobOpeningBodySchema,
  normalizeJobOpening,
  updateJobOpening,
  validateJobOpening,
} from "@/lib/hris/job-openings";
import { readJson } from "@/lib/hris/workforce-route";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export const PATCH = apiHandler(async (request: NextRequest, { params }: RouteParams) => {
  const guard = await requireIamGuard(IAM.hrisRecruitment);
  if (guard.error) return guard.error;
  const { id } = await params;
  const payload = normalizeJobOpening(await readJson(request, jobOpeningBodySchema), "update");
  const invalid = validateJobOpening(payload, "update");
  if (invalid) throw ApiError.badRequest(invalid);

  const data = await updateJobOpening(id, payload);
  return NextResponse.json({ data, message: "Lowongan berhasil diperbarui" });
}, "hris/job-openings PATCH");

export const DELETE = apiHandler(async (_request: NextRequest, { params }: RouteParams) => {
  const guard = await requireIamGuard(IAM.hrisRecruitment);
  if (guard.error) return guard.error;
  await deleteJobOpening((await params).id);
  return NextResponse.json({ message: "Lowongan berhasil dihapus" });
}, "hris/job-openings DELETE");
