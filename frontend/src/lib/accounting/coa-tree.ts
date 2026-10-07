export interface CoaTreeItem {
  id: string;
  parent_id: string | null;
  code: string;
  name: string;
  level: number;
  is_postable: boolean;
  is_active: boolean;
}

export interface CoaTreeNode<T extends CoaTreeItem = CoaTreeItem> {
  item: T;
  children: CoaTreeNode<T>[];
}

export interface FlatCoaTreeRow<T extends CoaTreeItem = CoaTreeItem> {
  item: T;
  depth: number;
  hasChildren: boolean;
  childrenCount: number;
  isFirst: boolean;
  isLast: boolean;
  parentContinuations: boolean[];
}

function sortSiblings<T extends CoaTreeItem>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => a.code.localeCompare(b.code) || a.name.localeCompare(b.name)
  );
}

export function buildCoaTree<T extends CoaTreeItem>(items: T[]): CoaTreeNode<T>[] {
  const byParent = new Map<string | null, T[]>();

  for (const item of items) {
    const key = item.parent_id;
    const list = byParent.get(key) ?? [];
    list.push(item);
    byParent.set(key, list);
  }

  const toNode = (item: T): CoaTreeNode<T> => ({
    item,
    children: sortSiblings(byParent.get(item.id) ?? []).map(toNode),
  });

  const ids = new Set(items.map((i) => i.id));
  const roots = items.filter(
    (i) => i.parent_id == null || !ids.has(i.parent_id)
  );

  return sortSiblings(roots).map(toNode);
}

export function flattenCoaTree<T extends CoaTreeItem>(
  nodes: CoaTreeNode<T>[],
  expandedIds: Set<string>,
  depth = 0,
  parentContinuations: boolean[] = []
): FlatCoaTreeRow<T>[] {
  const rows: FlatCoaTreeRow<T>[] = [];

  nodes.forEach((node, index) => {
    const hasChildren = node.children.length > 0;
    const isLast = index === nodes.length - 1;

    rows.push({
      item: node.item,
      depth,
      hasChildren,
      childrenCount: node.children.length,
      isFirst: index === 0,
      isLast,
      parentContinuations: [...parentContinuations],
    });

    if (hasChildren && expandedIds.has(node.item.id)) {
      rows.push(
        ...flattenCoaTree(node.children, expandedIds, depth + 1, [
          ...parentContinuations,
          !isLast,
        ])
      );
    }
  });

  return rows;
}

export function collectExpandableCoaIds<T extends CoaTreeItem>(
  nodes: CoaTreeNode<T>[]
): string[] {
  const ids: string[] = [];
  const walk = (list: CoaTreeNode<T>[]) => {
    for (const node of list) {
      if (node.children.length > 0) {
        ids.push(node.item.id);
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return ids;
}
