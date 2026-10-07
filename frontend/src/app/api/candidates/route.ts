import { NextResponse, type NextRequest } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { checkRateLimit, getRateLimitHeaders } from "@/lib/rate-limit";
import { candidateCreateSchema, parseCandidateListQuery } from "@/lib/recruitment/candidate-query";
import { createCandidate, listCandidates, parseBody } from "@/lib/recruitment/candidates-repo";

/** Batas per user (bukan X-Forwarded-For yang bisa dipalsukan klien). */
function rateLimited(key: string) {
  if (!checkRateLimit(key).allowed) throw ApiError.tooManyRequests();
  return getRateLimitHeaders(key);
}

// GET /api/candidates: daftar kandidat berfilter, 20 per halaman (all=true tanpa paging)
export const GET = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.hrisRecruitment);
  const headers = rateLimited(`candidates_get_${user.id}`);

  const parsed = parseCandidateListQuery(new URL(request.url).searchParams);
  if (!parsed.success) {
    throw ApiError.badRequest(parsed.error.issues[0]?.message || "Parameter tidak valid", parsed.error.issues);
  }
  const q = parsed.data;
  const { rows, total } = await listCandidates(q);
  const limit = q.all ? Math.max(total, 1) : q.limit;
  const page = q.all ? 1 : q.page;
  const totalPages = Math.ceil(total / limit);

  return NextResponse.json(
    {
      data: rows,
      meta: { total, page, limit, totalPages, hasNextPage: page < totalPages, hasPrevPage: page > 1 },
    },
    { headers }
  );
}, "api/candidates");

// POST /api/candidates: tambah kandidat manual
export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.hrisRecruitment);
  const headers = rateLimited(`candidates_post_${user.id}`);
  const input = await parseBody(request, candidateCreateSchema);
  const data = await createCandidate(input, user.id);
  return NextResponse.json({ data, message: "Kandidat berhasil ditambahkan" }, { status: 201, headers });
}, "api/candidates");
