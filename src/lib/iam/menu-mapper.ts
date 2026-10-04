import type { MenuDetail, MenuItem, MenuPermissionContext } from "./menu-types";

type MenuRow = {
  id: string;
  parent_id: string | null;
  code: string;
  menu_name: string;
  description?: string | null;
  route_path: string | null;
  module: string | null;
  menu_type: string;
  icon: string | null;
  order_number: number;
  level: number;
  is_active: boolean;
  is_visible: boolean;
  open_in_new_tab?: boolean;
  permission_context?: MenuPermissionContext | null;
  created_at?: string;
  updated_at?: string | null;
  version?: number;
};

export function mapMenuItem(row: MenuRow): MenuItem {
  return {
    id: row.id,
    parentId: row.parent_id,
    code: row.code,
    menuName: row.menu_name,
    routePath: row.route_path,
    module: row.module,
    menuType: row.menu_type,
    icon: row.icon,
    orderNumber: row.order_number,
    level: row.level,
    isActive: row.is_active,
    isVisible: row.is_visible,
  };
}

export function mapMenuDetail(row: MenuRow): MenuDetail {
  return {
    ...mapMenuItem(row),
    description: row.description ?? null,
    permissionContext: row.permission_context ?? { actions: ["read"] },
    openInNewTab: row.open_in_new_tab ?? false,
    createdAt: row.created_at ?? new Date().toISOString(),
    updatedAt: row.updated_at ?? null,
    version: row.version ?? 1,
  };
}

export function filterMenuRows(
  rows: MenuItem[],
  params: { search?: string; status?: string; menuType?: string }
) {
  const search = params.search?.trim().toLowerCase();
  const status = params.status?.trim().toLowerCase();
  const menuType = params.menuType?.trim().toLowerCase();

  return rows.filter((row) => {
    if (status === "active" && !row.isActive) return false;
    if (status === "inactive" && row.isActive) return false;
    if (menuType && row.menuType.toLowerCase() !== menuType) return false;
    if (!search) return true;

    return (
      row.menuName.toLowerCase().includes(search) ||
      row.code.toLowerCase().includes(search) ||
      (row.routePath ?? "").toLowerCase().includes(search) ||
      (row.module ?? "").toLowerCase().includes(search)
    );
  });
}
