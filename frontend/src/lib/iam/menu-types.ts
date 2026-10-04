export interface MenuPermissionContext {
  actions: string[];
}

export interface MenuItem {
  id: string;
  parentId: string | null;
  code: string;
  menuName: string;
  routePath: string | null;
  module: string | null;
  menuType: string;
  icon: string | null;
  orderNumber: number;
  level: number;
  isActive: boolean;
  isVisible: boolean;
}

export interface MenuDetail extends MenuItem {
  description: string | null;
  permissionContext: MenuPermissionContext;
  openInNewTab: boolean;
  createdAt: string;
  updatedAt: string | null;
  version: number;
}

export interface CreateMenuPayload {
  parentId?: string | null;
  code: string;
  menuName: string;
  description?: string;
  routePath?: string;
  module?: string;
  menuType?: "sidebar" | "group";
  icon?: string;
  orderNumber?: number;
  isVisible?: boolean;
  isActive?: boolean;
  openInNewTab?: boolean;
  permissionContext?: MenuPermissionContext;
}

export type UpdateMenuPayload = Partial<CreateMenuPayload>;
