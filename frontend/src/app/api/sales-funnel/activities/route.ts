import { NextRequest } from "next/server";
import { createdResponse, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { requireAccessibleSubject } from "@/lib/sales-funnel/access";
import {
  createActivity,
  listAgenda,
  listSubjectActivities,
  subjectFromSearchParams,
} from "@/lib/sales-funnel/activities-server";
import { requireSalesFunnelUser, requireSalesScope } from "@/lib/sales-funnel/server";
import { createTaskSchema } from "@/lib/sales-funnel/tasks";

/** Timeline satu subjek (akses lewat induknya) atau agenda/kalender user. */
export const GET = apiHandler(async (request: NextRequest) => {
  const user = await requireSalesFunnelUser();
  const searchParams = request.nextUrl.searchParams;
  const subject = subjectFromSearchParams(searchParams);
  if (subject) {
    await requireAccessibleSubject(subject.subject_type, subject.subject_id, user);
    return successResponse(await listSubjectActivities(subject));
  }
  const scope = await requireSalesScope(user);
  return successResponse(await listAgenda(user, scope, searchParams));
}, "sales-funnel.activities.GET");

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireSalesFunnelUser();
  const body = await validateBody(request, createTaskSchema);
  return createdResponse(await createActivity(user, body), "Task dicatat");
}, "sales-funnel.activities.POST");
