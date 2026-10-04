import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { filterRoleRows, mapRoleItem } from "@/lib/iam/role-mapper";
import { createIamRoleInDb, listIamRolesFromDb } from "@/lib/iam/role-repository";
import { roleCreateSchema } from "@/lib/settings/iam-schemas";

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.settingsRoles);
  const sp = request.nextUrl.searchParams;
  const filtered = filterRoleRows((await listIamRolesFromDb()).map(mapRoleItem), {
    search: sp.get("search") ?? undefined,
    status: sp.get("status") ?? undefined,
  });
  return NextResponse.json({ data: filtered, total: filtered.length });
}, "GET /api/settings/iam/roles");

export const POST = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.settingsRoles);
  const body = await validateBody(request, roleCreateSchema);
  const id = await createIamRoleInDb({
    code: body.code.toLowerCase(),
    name: body.name,
    description: body.description?.trim() || null,
    isActive: body.isActive ?? true,
  });
  return NextResponse.json({ id }, { status: 201 });
}, "POST /api/settings/iam/roles");
