export const IAM_SCHEMA = "iam" as const;

export type NavIconName =
  | "home"
  | "users"
  | "clipboard"
  | "star"
  | "chart"
  | "settings"
  | "logout"
  | "briefcase"
  | "shopping"
  | "cube"
  | "pr"
  | "po"
  | "reports"
  | "sitemap"
  | "database"
  | "folder"
  | "building"
  | "identification"
  | "calendar"
  | "dollar-sign"
  | "money"
  | "user-plus"
  | "file-text"
  | "chart-bar"
  | "plus"
  | "paper-airplane"
  | "check-circle"
  | "chart-pie"
  | "arrow-down-on-square"
  | "truck"
  | "document-magnifying-glass"
  | "circle-stack"
  | "document-text"
  | "clipboard-document-check"
  | "megaphone"
  | "banknotes"
  | "ticket"
  | "clock"
  | "video"
  | "map"
  | "palette"
  | "plug"
  | "shopping-bag"
  | "store"
  | "package"
  | "bar-chart-3";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIconName;
  children?: NavItem[];
}

export interface MenuRow {
  id: string;
  parent_id: string | null;
  code: string;
  menu_name: string;
  route_path: string | null;
  icon: string | null;
  order_number: number;
  level: number;
  menu_type: string;
  is_visible: boolean;
  is_active: boolean;
}

export const MENU_TYPES = ["sidebar", "group"] as const;

export type MenuType = (typeof MENU_TYPES)[number];

/** @deprecated Use MenuType. Kept for sidebar nav filtering. */
export type NavVisibleMenuType = MenuType;

/** @deprecated Use MENU_TYPES */
export const NAV_VISIBLE_MENU_TYPES = MENU_TYPES;

/** Sidebar supports `sidebar` (page link) and `group` (folder). */
export function isNavVisibleMenuType(menuType: string): menuType is MenuType {
  return menuType === "sidebar" || menuType === "group";
}

/** Permission verb stored in `iam.menus.permission_context`. Custom values are allowed. */
export type MenuAction = string;

export const SUGGESTED_MENU_ACTIONS = [
  "read",
  "create",
  "update",
  "delete",
  "approve",
  "export",
  "import",
  "execute",
] as const;

export type SuggestedMenuAction = (typeof SUGGESTED_MENU_ACTIONS)[number];

export interface PermissionContext {
  actions?: MenuAction[];
}
