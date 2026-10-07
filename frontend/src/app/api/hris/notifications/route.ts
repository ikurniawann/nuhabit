import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import {
  listNotifications,
  markNotificationsRead,
  markReadSchema,
  notificationListQuerySchema,
} from "@/lib/hris/notifications-repo";
import { readJson } from "@/lib/hris/workforce-route";
import { parseInput, searchParamsOf } from "@/lib/payroll/request-input";

/** GET /api/hris/notifications?limit&unread=true: notifikasi milik user. */
export const GET = apiHandler(async (request: NextRequest) => {
  const user = await requireApiUser();
  const query = parseInput(notificationListQuerySchema, searchParamsOf(request));
  return NextResponse.json(await listNotifications(user.id, query));
}, "hris/notifications.GET");

/** POST /api/hris/notifications { notification_id } | { mark_all: true }: tandai dibaca. */
export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireApiUser();
  const input = await readJson(request, markReadSchema);
  return NextResponse.json(await markNotificationsRead(user.id, input));
}, "hris/notifications.POST");
