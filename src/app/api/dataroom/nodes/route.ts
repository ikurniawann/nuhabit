import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireIamAction, requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { DATAROOM_MAX_FILE_BYTES, DATAROOM_QUOTA_BYTES } from "@/lib/dataroom/config";
import { createFolder, getAncestors, getNode, listChildren, usedBytes } from "@/lib/dataroom/nodes";
import { getDataroomPermissions } from "@/lib/dataroom/api";
import { createAccessResolver, getDepartmentsForNodes, resolveActor } from "@/lib/dataroom/access";

/**
 * GET /api/dataroom/nodes?parent=<id>  — isi folder (root bila kosong),
 * jejak breadcrumb, pemakaian kuota, dan hak aksi user.
 * POST /api/dataroom/nodes { name, parent_id } — folder baru.
 */
export const GET = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.dataroom);
  const parentId = request.nextUrl.searchParams.get("parent") || null;
  let parent = null;
  if (parentId) {
    parent = await getNode(parentId);
    if (!parent || parent.kind !== "folder") throw ApiError.notFound("Folder tidak ditemukan");
  }
  const actor = await resolveActor(user);
  const access = await createAccessResolver(actor);
  if (parentId && !access.allowsFolder(parentId)) {
    throw ApiError.forbidden("Folder ini tidak dibuka untuk departemen Anda");
  }
  const [children, ancestors, used, permissions] = await Promise.all([
    listChildren(parentId),
    parentId ? getAncestors(parentId) : Promise.resolve([]),
    usedBytes(),
    getDataroomPermissions(user),
  ]);
  // Folder yang tidak dibuka untuk departemen user disembunyikan.
  const visible = children.filter((n) => access.allows(n));
  const deptMap = await getDepartmentsForNodes(visible.filter((n) => n.kind === "folder").map((n) => n.id));
  const items = visible.map((n) => ({ ...n, departments: deptMap.get(n.id) ?? [] }));
  return NextResponse.json({
    success: true,
    data: {
      parent, items, ancestors,
      usage: { used, quota: DATAROOM_QUOTA_BYTES, max_file: DATAROOM_MAX_FILE_BYTES },
      permissions: { ...permissions, manage_access: actor.isAdmin },
      actor: { is_admin: actor.isAdmin, department_name: actor.departmentName },
    },
  });
}, "dataroom.nodes.GET");

const createSchema = z.object({
  name: z.string().trim().min(1).max(255),
  parent_id: z.string().uuid().nullable().optional(),
});

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireIamAction(IAM.dataroom, "create");
  const body = await validateBody(request, createSchema);
  const parentId = body.parent_id ?? null;
  if (parentId) {
    const parent = await getNode(parentId);
    if (!parent || parent.kind !== "folder") throw ApiError.notFound("Folder induk tidak ditemukan");
    const access = await createAccessResolver(await resolveActor(user));
    if (!access.allowsFolder(parentId)) throw ApiError.forbidden("Folder ini tidak dibuka untuk departemen Anda");
  }
  const node = await createFolder({ parentId, name: body.name, userId: user.id, userName: user.full_name });
  return NextResponse.json({ success: true, data: node }, { status: 201 });
}, "dataroom.nodes.POST");
