import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { mapMenuDetail } from "@/lib/iam/menu-mapper";
import { deleteIamMenuInDb, getIamMenuFromDb, updateIamMenuInDb } from "@/lib/iam/menu-repository";
import { menuUpdateSchema } from "@/lib/settings/iam-schemas";

type RouteContext = { params: Promise<{ id: string }> };

const notFound = () => ApiError.notFound("Menu not found");

export const GET = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.settingsMenus);
  const row = await getIamMenuFromDb((await params).id);
  if (!row) throw notFound();
  return NextResponse.json(mapMenuDetail(row));
}, "GET /api/settings/iam/menus/[id]");

export const PUT = apiHandler(async (request: NextRequest, { params }: RouteContext) => {
  const user = await requireIamMenuPrefix(IAM.settingsMenus);
  const { id } = await params;
  const body = await validateBody(request, menuUpdateSchema);
  if (!(await updateIamMenuInDb(id, body, user.id))) throw notFound();
  return NextResponse.json({ id });
}, "PUT /api/settings/iam/menus/[id]");

export const DELETE = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  const user = await requireIamMenuPrefix(IAM.settingsMenus);
  if (!(await deleteIamMenuInDb((await params).id, user.id))) throw notFound();
  return NextResponse.json({ success: true });
}, "DELETE /api/settings/iam/menus/[id]");
