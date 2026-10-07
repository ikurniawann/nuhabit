import type { MenuItem } from "@/lib/iam/menu-types";

export interface MenuTreeNode extends MenuItem {
  children: MenuTreeNode[];
}

export interface FlatMenuTreeRow {
  item: MenuItem;
  depth: number;
  hasChildren: boolean;
  childrenCount: number;
  /** First sibling at this depth — disables move up */
  isFirst: boolean;
  /** Last sibling at this depth — controls └ vs ├ and disables move down */
  isLast: boolean;
  /** Vertical guides for ancestor levels */
  parentContinuations: boolean[];
}

export function sortSiblings(items: MenuItem[]): MenuItem[] {
  return [...items].sort(
    (a, b) =>
      a.orderNumber - b.orderNumber || a.menuName.localeCompare(b.menuName),
  );
}

export function buildMenuTree(items: MenuItem[]): MenuTreeNode[] {
  const byParent = new Map<string | null, MenuItem[]>();

  for (const item of items) {
    const key = item.parentId;
    const list = byParent.get(key) ?? [];
    list.push(item);
    byParent.set(key, list);
  }

  const toNode = (item: MenuItem): MenuTreeNode => ({
    ...item,
    children: sortSiblings(byParent.get(item.id) ?? []).map(toNode),
  });

  return sortSiblings(byParent.get(null) ?? []).map(toNode);
}

export function flattenMenuTree(
  nodes: MenuTreeNode[],
  expandedIds: Set<string>,
  depth = 0,
  parentContinuations: boolean[] = [],
): FlatMenuTreeRow[] {
  const rows: FlatMenuTreeRow[] = [];

  nodes.forEach((node, index) => {
    const hasChildren = node.children.length > 0;
    const isLast = index === nodes.length - 1;

    rows.push({
      item: node,
      depth,
      hasChildren,
      childrenCount: node.children.length,
      isFirst: index === 0,
      isLast,
      parentContinuations: [...parentContinuations],
    });

    if (hasChildren && expandedIds.has(node.id)) {
      rows.push(
        ...flattenMenuTree(node.children, expandedIds, depth + 1, [
          ...parentContinuations,
          !isLast,
        ]),
      );
    }
  });

  return rows;
}

export function collectExpandableIds(nodes: MenuTreeNode[]): string[] {
  const ids: string[] = [];

  const walk = (list: MenuTreeNode[]) => {
    for (const node of list) {
      if (node.children.length > 0) {
        ids.push(node.id);
        walk(node.children);
      }
    }
  };

  walk(nodes);
  return ids;
}


function itemMatchesFilter(
  item: MenuItem,
  params: { search?: string; status?: string; menuType?: string },
): boolean {
  const search = params.search?.trim().toLowerCase();
  const status = params.status?.trim().toLowerCase();
  const menuType = params.menuType?.trim().toLowerCase();

  if (status === "active" && !item.isActive) return false;
  if (status === "inactive" && item.isActive) return false;
  if (menuType && item.menuType.toLowerCase() !== menuType) return false;

  if (!search) return true;

  return (
    item.menuName.toLowerCase().includes(search) ||
    item.code.toLowerCase().includes(search) ||
    (item.routePath ?? "").toLowerCase().includes(search) ||
    (item.module ?? "").toLowerCase().includes(search)
  );
}

/** Keep matched rows plus all ancestors so tree structure stays intact. */
export function filterMenusWithAncestors(
  items: MenuItem[],
  params: { search?: string; status?: string; menuType?: string },
): MenuItem[] {
  const hasFilter = Boolean(
    params.search?.trim() || params.status?.trim() || params.menuType?.trim(),
  );

  if (!hasFilter) return items;

  const byId = new Map(items.map((item) => [item.id, item]));
  const keepIds = new Set<string>();

  for (const item of items) {
    if (!itemMatchesFilter(item, params)) continue;

    keepIds.add(item.id);
    let parentId = item.parentId;
    while (parentId) {
      keepIds.add(parentId);
      parentId = byId.get(parentId)?.parentId ?? null;
    }
  }

  return items.filter((item) => keepIds.has(item.id));
}
