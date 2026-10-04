import type { MenuItem } from "@/lib/iam/menu-types";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^\w\s/-]/g, "")
    .replace(/[/\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function routeSegment(routePath: string): string {
  const segments = routePath.split("/").filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : "";
}

export function generateMenuCode(params: {
  menuName: string;
  module: string;
  routePath: string;
  parentId: string | null;
  menus: MenuItem[];
  existingCodes: Set<string>;
  excludeCode?: string;
}): string {
  const slugFromRoute = slugify(routeSegment(params.routePath));
  const slugFromName = slugify(params.menuName);
  const slug = slugFromRoute || slugFromName || "menu";

  let base: string;

  if (params.parentId) {
    const parent = params.menus.find((menu) => menu.id === params.parentId);
    base = parent ? `${parent.code}.${slug}` : slug;
  } else if (params.module.trim()) {
    base = `${slugify(params.module)}.${slug}`;
  } else {
    base = slug;
  }

  let code = base;
  let counter = 2;

  while (params.existingCodes.has(code) && code !== params.excludeCode) {
    code = `${base}.${counter}`;
    counter += 1;
  }

  return code;
}
