import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import {
  getIamRoleFromDb,
  listRolePermissionsMatrixFromDb,
  replaceIamRolePermissionsInDb,
} from "@/lib/iam/role-repository";
import { mapRoleDetail } from "@/lib/iam/role-mapper";
import { normalizeRolePermissions, rolePermissionsSchema } from "@/lib/settings/iam-schemas";

type RouteContext = { params: Promise<{ id: string }> };

async function getRoleOr404(id: string) {
  const row = await getIamRoleFromDb(id);
  if (!row) throw ApiError.notFound("Role not found");
  return row;
}

async function permissionsResponse(id: string, row: Awaited<ReturnType<typeof getRoleOr404>>) {
  const matrix = await listRolePermissionsMatrixFromDb(id);
  return NextResponse.json({ roleId: id, permissions: mapRoleDetail(row, matrix).permissions });
}

export const GET = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.settingsRoles);
  const { id } = await params;
  return permissionsResponse(id, await getRoleOr404(id));
}, "GET /api/settings/iam/roles/[id]/permissions");

export const PUT = apiHandler(async (request: NextRequest, { params }: RouteContext) => {
  const user = await requireIamMenuPrefix(IAM.settingsRoles);
  const { id } = await params;
  const body = await validateBody(request, rolePermissionsSchema);
  const row = await getRoleOr404(id);
  await replaceIamRolePermissionsInDb(id, normalizeRolePermissions(body.permissions), user.id);
  return permissionsResponse(id, row);
}, "PUT /api/settings/iam/roles/[id]/permissions");
