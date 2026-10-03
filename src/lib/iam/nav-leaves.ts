import type { NavIconName, NavItem } from "@/lib/iam/types";

export interface NavLeaf {
  href: string;
  label: string;
  icon: NavIconName;
  /** Top-level menu the leaf belongs to (its own label for a top-level link). */
  section: string;
}

function isRealHref(href: string | undefined): href is string {
  return Boolean(href && href !== "#");
}

/** Every navigable page in the IAM menu tree, in menu order. */
export function flattenNavLeaves(items: NavItem[]): NavLeaf[] {
  const leaves: NavLeaf[] = [];
  const walk = (nodes: NavItem[], section: string) => {
    for (const node of nodes) {
      if (node.children?.length) walk(node.children, section);
      else if (isRealHref(node.href)) {
        leaves.push({ href: node.href, label: node.label, icon: node.icon, section });
      }
    }
  };
  for (const item of items) {
    if (item.children?.length) walk(item.children, item.label);
    else if (isRealHref(item.href)) {
      leaves.push({ href: item.href, label: item.label, icon: item.icon, section: item.label });
    }
  }
  return leaves;
}

/** Every typed word must appear in the page or section label. */
export function matchesNavQuery(leaf: NavLeaf, query: string): boolean {
  const haystack = `${leaf.label} ${leaf.section}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}
