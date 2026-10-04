import type { NextRequest } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { requireCrmUser } from "@/lib/crm/guards";
import { listMemberReviews } from "@/lib/crm/member-reviews-server";

/** GET — daftar ulasan member + ringkasan (filter: status, rating, branch_id, q, from/to). */
export const GET = apiHandler(async (request: NextRequest) => {
  await requireCrmUser("memberReviews");
  return successResponse(await listMemberReviews(request.nextUrl.searchParams));
}, "crm.member-reviews.GET");
