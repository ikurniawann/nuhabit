import { ApiError, successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { parseCrmInput, requireCrmUser } from "@/lib/crm/guards";
import { memberReviewPatchSchema, updateMemberReview } from "@/lib/crm/member-reviews-server";

/** PATCH — balas ulasan atau sembunyikan/tampilkan lagi. */
export const PATCH = apiHandler(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireCrmUser("memberReviews");
  const { id } = await params;
  const body = parseCrmInput(memberReviewPatchSchema, await request.json());
  const result = await updateMemberReview(id, body, user.id);
  if (!result) throw ApiError.notFound("Ulasan tidak ditemukan");
  return successResponse({ id: result.id, status: result.status });
}, "crm.member-reviews.[id].PATCH");
