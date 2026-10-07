export type IamRoleRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_system: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string | null;
  version: number;
  menu_permission_count?: number;
};

export type IamRolePermissionRow = {
  menu_id: string;
  menu_code: string;
  menu_name: string;
  menu_type: string;
  parent_id: string | null;
  level: number;
  order_number: number;
  permission_context: { actions?: string[] } | null;
  granted_actions: string[] | null;
  permission_id: string | null;
  permission_is_active: boolean | null;
};

export function mapRoleItem(row: IamRoleRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    isSystem: row.is_system,
    isActive: row.is_active,
    menuPermissionCount: Number(row.menu_permission_count ?? 0),
  };
}

export function mapRoleDetail(row: IamRoleRow, permissions: IamRolePermissionRow[]) {
  return {
    ...mapRoleItem(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
    permissions: permissions.map((permission) => {
      const availableActions =
        permission.permission_context?.actions && permission.permission_context.actions.length > 0
          ? permission.permission_context.actions
          : ["read"];
      const grantedActions = Array.isArray(permission.granted_actions)
        ? permission.granted_actions
        : [];
      const isGranted = Boolean(permission.permission_id && permission.permission_is_active);

      return {
        menuId: permission.menu_id,
        menuCode: permission.menu_code,
        menuName: permission.menu_name,
        menuType: permission.menu_type,
        parentId: permission.parent_id,
        level: permission.level,
        orderNumber: permission.order_number,
        availableActions,
        grantedActions: isGranted ? grantedActions : [],
        isGranted,
      };
    }),
  };
}

export function filterRoleRows<T extends { code: string; name: string; description: string | null; isActive: boolean }>(
  rows: T[],
  params: { search?: string; status?: string }
) {
  const search = params.search?.trim().toLowerCase();
  const status = params.status?.trim().toLowerCase();

  return rows.filter((row) => {
    if (status === "active" && !row.isActive) return false;
    if (status === "inactive" && row.isActive) return false;
    if (!search) return true;

    return (
      row.code.toLowerCase().includes(search) ||
      row.name.toLowerCase().includes(search) ||
      (row.description ?? "").toLowerCase().includes(search)
    );
  });
}
