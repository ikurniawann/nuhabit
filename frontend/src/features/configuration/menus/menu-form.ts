import type { CreateMenuPayload, MenuItem } from "@/lib/iam/menu-types";

/** State & aturan murni form menu IAM (diuji unit). */

export interface MenuFormValues {
  parentId: string | null;
  code: string;
  menuName: string;
  description: string;
  routePath: string;
  module: string;
  menuType: "sidebar" | "group";
  icon: string;
  orderNumber: number;
  isVisible: boolean;
  isActive: boolean;
  openInNewTab: boolean;
  permissionActions: string[];
}

export function defaultFormValues(
  defaultParentId?: string | null,
): MenuFormValues {
  return {
    parentId: defaultParentId ?? null,
    code: "",
    menuName: "",
    description: "",
    routePath: "",
    module: "",
    menuType: "sidebar",
    icon: "clipboard",
    orderNumber: 0,
    isVisible: true,
    isActive: true,
    openInNewTab: false,
    permissionActions: ["read"],
  };
}

function collectDescendantIds(id: string, items: MenuItem[]): Set<string> {
  const ids = new Set<string>();
  const queue = [id];

  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const item of items) {
      if (item.parentId === current && !ids.has(item.id)) {
        ids.add(item.id);
        queue.push(item.id);
      }
    }
  }

  return ids;
}

export function buildParentOptions(
  menus: MenuItem[],
  excludeId?: string | null,
) {
  const exclude = new Set<string>();
  if (excludeId) {
    exclude.add(excludeId);
    for (const id of collectDescendantIds(excludeId, menus)) {
      exclude.add(id);
    }
  }

  return menus
    .filter((menu) => !exclude.has(menu.id))
    .sort(
      (a, b) =>
        a.level - b.level ||
        a.orderNumber - b.orderNumber ||
        a.menuName.localeCompare(b.menuName),
    )
    .map((menu) => ({
      id: menu.id,
      label: `${menu.level > 0 ? "— ".repeat(menu.level) : ""}${menu.menuName}`,
    }));
}

export function toFormValues(detail: {
  parentId: string | null;
  code: string;
  menuName: string;
  description: string | null;
  routePath: string | null;
  module: string | null;
  menuType: string;
  icon: string | null;
  orderNumber: number;
  isVisible: boolean;
  isActive: boolean;
  openInNewTab: boolean;
  permissionContext: { actions?: string[] };
}): MenuFormValues {
  return {
    parentId: detail.parentId,
    code: detail.code,
    menuName: detail.menuName,
    description: detail.description ?? "",
    routePath: detail.routePath ?? "",
    module: detail.module ?? "",
    menuType: detail.menuType === "group" ? "group" : "sidebar",
    icon: detail.icon ?? "clipboard",
    orderNumber: detail.orderNumber,
    isVisible: detail.isVisible,
    isActive: detail.isActive,
    openInNewTab: detail.openInNewTab,
    permissionActions:
      detail.permissionContext?.actions &&
      detail.permissionContext.actions.length > 0
        ? detail.permissionContext.actions
        : ["read"],
  };
}

export function toPayload(values: MenuFormValues): CreateMenuPayload {
  return {
    parentId: values.parentId,
    code: values.code.trim(),
    menuName: values.menuName.trim(),
    description: values.description.trim() || undefined,
    routePath: values.routePath.trim() || undefined,
    module: values.module.trim() || undefined,
    menuType: values.menuType,
    icon: values.icon.trim() || undefined,
    orderNumber: values.orderNumber,
    isVisible: values.isVisible,
    isActive: values.isActive,
    openInNewTab: values.openInNewTab,
    permissionContext: {
      actions:
        values.permissionActions.length > 0
          ? values.permissionActions
          : ["read"],
    },
  };
}

/** Menu anak tanpa module mewarisi module parent. */
export function effectiveModule(
  form: MenuFormValues,
  menus: MenuItem[],
): string {
  if (form.module || !form.parentId) return form.module;
  return menus.find((menu) => menu.id === form.parentId)?.module ?? "";
}
