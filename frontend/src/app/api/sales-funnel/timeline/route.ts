import { NextRequest } from "next/server";
import { ApiError, successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { requireAccessibleSubject } from "@/lib/sales-funnel/access";
import { requireSalesFunnelUser } from "@/lib/sales-funnel/server";
import { isUuid } from "@/lib/sales-funnel/sql";
import { TASK_SUBJECT_TYPES, type TaskSubjectType } from "@/lib/sales-funnel/tasks";
import { loadTimeline } from "@/lib/sales-funnel/timeline-server";

/** EPIC-050 Fase 1 (T-1.4) — GET /api/sales-funnel/timeline?subject_type=&subject_id=[&limit=] */
export const GET = apiHandler(async (request: NextRequest) => {
  const user = await requireSalesFunnelUser();
  const searchParams = request.nextUrl.searchParams;
  const subjectType = searchParams.get("subject_type") ?? "";
  const subjectId = searchParams.get("subject_id") ?? "";
  const limit = Math.min(300, Math.max(10, Number(searchParams.get("limit")) || 100));
  if (!(TASK_SUBJECT_TYPES as readonly string[]).includes(subjectType) || !isUuid(subjectId)) {
    throw ApiError.badRequest("subject_type & subject_id wajib");
  }
  const type = subjectType as TaskSubjectType;
  await requireAccessibleSubject(type, subjectId, user);
  return successResponse(await loadTimeline(type, subjectId, limit));
}, "sales-funnel.timeline.GET");
