export interface RoleItem {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  menuPermissionCount: number;
}

export interface RoleMenuPermission {
  menuId: string;
  menuCode: string;
  menuName: string;
  menuType: string;
  parentId: string | null;
  level: number;
  orderNumber: number;
  availableActions: string[];
  grantedActions: string[];
  isGranted: boolean;
}

export interface RoleDetail extends RoleItem {
  createdAt: string;
  updatedAt: string | null;
  version: number;
  permissions: RoleMenuPermission[];
}

export interface CreateRolePayload {
  code: string;
  name: string;
  description?: string;
  isActive?: boolean;
}

export type UpdateRolePayload = Partial<CreateRolePayload>;

export interface RolePermissionUpdate {
  menuId: string;
  grantedActions: string[];
  isGranted?: boolean;
}
