import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { filterMenuRows, mapMenuItem } from "@/lib/iam/menu-mapper";
import { createIamMenuInDb, listIamMenusFromDb } from "@/lib/iam/menu-repository";
import { menuPayloadSchema } from "@/lib/settings/iam-schemas";

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.settingsMenus);
  const sp = request.nextUrl.searchParams;
  const filtered = filterMenuRows((await listIamMenusFromDb()).map(mapMenuItem), {
    search: sp.get("search") ?? undefined,
    status: sp.get("status") ?? undefined,
    menuType: sp.get("menuType") ?? undefined,
  });
  return NextResponse.json({ data: filtered, total: filtered.length });
}, "GET /api/settings/iam/menus");

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.settingsMenus);
  const body = await validateBody(request, menuPayloadSchema);
  const id = await createIamMenuInDb(body, user.id);
  return NextResponse.json({ id }, { status: 201 });
}, "POST /api/settings/iam/menus");
