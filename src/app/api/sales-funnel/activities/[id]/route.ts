import { NextRequest } from "next/server";
import { noContentResponse, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { requireAccessibleActivity } from "@/lib/sales-funnel/access";
import { deleteActivity, updateActivity } from "@/lib/sales-funnel/activities-server";
import { requireSalesFunnelUser } from "@/lib/sales-funnel/server";
import { updateTaskSchema } from "@/lib/sales-funnel/tasks";

type Params = { params: Promise<{ id: string }> };

export const PATCH = apiHandler(async (request: NextRequest, { params }: Params) => {
  const user = await requireSalesFunnelUser();
  const { id } = await params;
  const activity = await requireAccessibleActivity(id, user);
  const body = await validateBody(request, updateTaskSchema);
  const result = await updateActivity(user, activity, body);
  return successResponse(
    result,
    result.next_task_id ? "Task selesai — kemunculan berikutnya dijadwalkan" : "Task diperbarui"
  );
}, "sales-funnel.activities.PATCH");

export const DELETE = apiHandler(async (_request: NextRequest, { params }: Params) => {
  const user = await requireSalesFunnelUser();
  const { id } = await params;
  await requireAccessibleActivity(id, user);
  await deleteActivity(id);
  return noContentResponse();
}, "sales-funnel.activities.DELETE");
