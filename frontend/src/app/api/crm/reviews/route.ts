import { NextRequest, NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getPool } from "@/lib/db";
import { requireCrmUser } from "@/lib/crm/guards";
import {
  applyGoogleReviewAction,
  listGoogleReviews,
  reviewActionSchema,
} from "@/lib/crm/google-reviews-inbox-server";
import { syncGoogleReviews } from "@/lib/crm/google-reviews-server";
import { CRM_REVIEW_APPROVER_ROLES } from "@/lib/crm/server";

/**
 * EPIC-013 Fase A — daftar & balas Google Review. Gate menu inbox CS:
 * membalas ulasan adalah pekerjaan CS yang tampil publik.
 */

export const GET = apiHandler(async (request: NextRequest) => {
  const user = await requireCrmUser("inbox");
  const params = request.nextUrl.searchParams;
  const data = await listGoogleReviews(
    { status: params.get("status"), rating: params.get("rating"), location: params.get("location") },
    CRM_REVIEW_APPROVER_ROLES.includes(user.role)
  );
  return NextResponse.json({ success: true, data });
}, "crm.reviews.GET");

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireCrmUser("inbox");
  const parsed = reviewActionSchema.safeParse(await request.json());
  if (!parsed.success) throw ApiError.badRequest("Payload tidak valid");
  const payload = parsed.data;

  if (payload.action === "sync") {
    const summary = await syncGoogleReviews(getPool());
    if (summary.error) {
      // notConfigured ikut dikirim supaya UI bisa membedakan 409 (belum diset) dari 502.
      return NextResponse.json(
        { success: false, error: summary.error, notConfigured: summary.notConfigured },
        { status: summary.notConfigured ? 409 : 502 }
      );
    }
    return NextResponse.json({ success: true, data: summary });
  }

  const canApprove = CRM_REVIEW_APPROVER_ROLES.includes(user.role);
  const result = await applyGoogleReviewAction(payload, { id: user.id, canApprove });
  return NextResponse.json(result ? { success: true, data: result } : { success: true });
}, "crm.reviews.POST");
