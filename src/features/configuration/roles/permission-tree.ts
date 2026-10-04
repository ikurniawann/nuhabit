import type { MenuItem } from "@/lib/iam/menu-types";
import type { RoleMenuPermission, RolePermissionUpdate } from "./types";

/** Aturan murni editor izin role per menu (diuji unit). */

export function buildChildrenByParent(permissions: RoleMenuPermission[]) {
  const byParent = new Map<string, RoleMenuPermission[]>();

  for (const permission of permissions) {
    if (!permission.parentId) continue;
    const list = byParent.get(permission.parentId) ?? [];
    list.push(permission);
    byParent.set(permission.parentId, list);
  }

  return byParent;
}

export function collectDescendantMenuIds(
  menuId: string,
  byParent: Map<string, RoleMenuPermission[]>,
): string[] {
  const ids: string[] = [];
  const queue = [menuId];

  while (queue.length > 0) {
    const current = queue.pop()!;
    const children = byParent.get(current) ?? [];

    for (const child of children) {
      ids.push(child.menuId);
      queue.push(child.menuId);
    }
  }

  return ids;
}

export function applyGrantState(
  permission: RoleMenuPermission,
  granted: boolean,
): RoleMenuPermission {
  return {
    ...permission,
    isGranted: granted,
    grantedActions: granted
      ? permission.grantedActions.length > 0
        ? permission.grantedActions
        : permission.availableActions.length > 0
          ? [permission.availableActions[0]]
          : ["read"]
      : [],
  };
}

export function permissionToMenuItem(permission: RoleMenuPermission): MenuItem {
  return {
    id: permission.menuId,
    parentId: permission.parentId,
    code: permission.menuCode,
    menuName: permission.menuName,
    routePath: null,
    module: null,
    menuType: permission.menuType,
    icon: null,
    orderNumber: permission.orderNumber,
    level: permission.level,
    isActive: true,
    isVisible: true,
  };
}

export function getGrantChecked(
  menuId: string,
  draft: Map<string, RoleMenuPermission>,
  byParent: Map<string, RoleMenuPermission[]>,
): boolean {
  const permission = draft.get(menuId);
  if (!permission) return false;
  if (permission.isGranted) return true;

  const children = byParent.get(menuId) ?? [];
  if (children.length === 0) return false;

  return children.every((child) =>
    getGrantChecked(child.menuId, draft, byParent),
  );
}

/** Centang/hapus grant menu beserta seluruh turunannya. */
export function setGrantWithDescendants(
  draft: Map<string, RoleMenuPermission>,
  menuId: string,
  granted: boolean,
): Map<string, RoleMenuPermission> {
  const next = new Map(draft);
  const byParent = buildChildrenByParent(Array.from(draft.values()));
  for (const id of [menuId, ...collectDescendantMenuIds(menuId, byParent)]) {
    const current = next.get(id);
    if (current) next.set(id, applyGrantState(current, granted));
  }
  return next;
}

/** Toggle satu aksi pada menu yang sudah di-grant; minimal tetap "read". */
export function toggleAction(
  permission: RoleMenuPermission,
  action: string,
): RoleMenuPermission {
  if (!permission.isGranted) return permission;
  const actions = permission.grantedActions.includes(action)
    ? permission.grantedActions.filter((item) => item !== action)
    : [...permission.grantedActions, action];
  return {
    ...permission,
    grantedActions: actions.length > 0 ? actions : ["read"],
  };
}

/** Menu yang cocok pencarian (nama/kode) beserta semua leluhurnya agar pohon tetap utuh. */
export function visibleMenuItems(
  permissions: RoleMenuPermission[],
  search: string,
): MenuItem[] {
  const items = permissions.map(permissionToMenuItem);
  const q = search.trim().toLowerCase();
  if (!q) return items;

  const byId = new Map(items.map((item) => [item.id, item]));
  const keep = new Set<string>();
  for (const p of permissions) {
    if (
      !p.menuName.toLowerCase().includes(q) &&
      !p.menuCode.toLowerCase().includes(q)
    )
      continue;
    let id: string | null = p.menuId;
    while (id && !keep.has(id)) {
      keep.add(id);
      id = byId.get(id)?.parentId ?? null;
    }
  }
  return items.filter((item) => keep.has(item.id));
}

export function permissionPayload(
  permissions: RoleMenuPermission[],
): RolePermissionUpdate[] {
  return permissions
    .filter((p) => p.isGranted)
    .map((p) => ({
      menuId: p.menuId,
      isGranted: true,
      grantedActions: p.grantedActions.length > 0 ? p.grantedActions : ["read"],
    }));
}
