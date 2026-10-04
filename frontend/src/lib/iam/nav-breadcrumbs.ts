import { isNavLinkActive } from "@/lib/iam/nav-active";
import type { NavItem } from "@/lib/iam/types";

export interface NavBreadcrumbItem {
  label: string;
  href?: string;
}

const HOME_HREF = "/dashboard";
const HOME_LABEL = "Beranda";

function isValidHref(href: string | undefined): href is string {
  return Boolean(href && href !== "#");
}

function humanizeSegment(segment: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) {
    return "Detail";
  }
  return segment
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function toCrumb(item: NavItem): NavBreadcrumbItem {
  return {
    label: item.label,
    ...(isValidHref(item.href) ? { href: item.href } : {}),
  };
}

/**
 * The more specific link wins (/dashboard/crm/challenges over a prefix match on
 * /dashboard/crm in another group); depth only breaks ties.
 */
function isBetterChain(candidate: NavBreadcrumbItem[], best: NavBreadcrumbItem[] | null): boolean {
  if (!best) return true;
  const hrefLength = (chain: NavBreadcrumbItem[]) => chain[chain.length - 1]?.href?.length ?? 0;
  const diff = hrefLength(candidate) - hrefLength(best);
  return diff !== 0 ? diff > 0 : candidate.length > best.length;
}

function findDeepestNavChain(
  items: NavItem[],
  pathname: string,
  navFrom: string | null,
  ancestors: NavBreadcrumbItem[] = [],
  peerHrefs: string[] = []
): NavBreadcrumbItem[] | null {
  let best: NavBreadcrumbItem[] | null = null;

  for (const item of items) {
    const childHrefs = item.children?.map((child) => child.href) ?? [];
    const chainHere = [...ancestors, toCrumb(item)];

    if (item.children?.length) {
      const fromChildren = findDeepestNavChain(
        item.children,
        pathname,
        navFrom,
        chainHere,
        childHrefs
      );
      if (fromChildren && isBetterChain(fromChildren, best)) {
        best = fromChildren;
      }
    }

    if (isValidHref(item.href) && isNavLinkActive(pathname, item.href, peerHrefs, navFrom)) {
      if (isBetterChain(chainHere, best)) {
        best = chainHere;
      }
    }
  }

  return best;
}

function fallbackFromPath(pathname: string): NavBreadcrumbItem[] {
  const parts = pathname.replace(/^\/dashboard\/?/, "").split("/").filter(Boolean);
  if (parts.length === 0) {
    return [{ label: HOME_LABEL }];
  }

  const crumbs: NavBreadcrumbItem[] = [{ label: HOME_LABEL, href: HOME_HREF }];
  let prefix = HOME_HREF;

  for (let index = 0; index < parts.length; index += 1) {
    const segment = parts[index];
    prefix += `/${segment}`;
    const isLast = index === parts.length - 1;
    crumbs.push({
      label: humanizeSegment(segment),
      ...(isLast ? {} : { href: prefix }),
    });
  }

  return crumbs;
}

function finalizeChain(chain: NavBreadcrumbItem[], pathname: string): NavBreadcrumbItem[] {
  const result = [...chain];
  const last = result[result.length - 1];
  if (!last) return result;

  const baseHref =
    [...result]
      .reverse()
      .find((crumb) => crumb.href)
      ?.href ?? last.href;

  if (baseHref && pathname !== baseHref && pathname.startsWith(`${baseHref}/`)) {
    const tail = pathname.slice(baseHref.length).replace(/^\/+/, "").split("/").filter(Boolean);
    let prefix = baseHref;

    for (let index = 0; index < tail.length; index += 1) {
      const segment = tail[index];
      prefix += `/${segment}`;
      const isLast = index === tail.length - 1;
      result.push({
        label: humanizeSegment(segment),
        ...(isLast ? {} : { href: prefix }),
      });
    }
    return result;
  }

  if (last.href === pathname) {
    result[result.length - 1] = { label: last.label };
  }

  return result;
}

/** Build breadcrumb trail from IAM sidebar tree + current pathname. */
export function buildNavBreadcrumbs(
  navItems: NavItem[],
  pathname: string,
  navFrom?: string | null
): NavBreadcrumbItem[] {
  const normalizedPath = pathname.replace(/\/+$/, "") || "/";

  if (normalizedPath === HOME_HREF) {
    return [{ label: HOME_LABEL }];
  }

  const navChain = findDeepestNavChain(
    navItems,
    normalizedPath,
    navFrom ?? null,
    [],
    navItems.map((item) => item.href)
  );

  if (!navChain?.length) {
    return finalizeChain(fallbackFromPath(normalizedPath), normalizedPath);
  }

  const withoutDuplicateHome = navChain.filter(
    (crumb, index) => !(index === 0 && crumb.href === HOME_HREF)
  );

  const chain: NavBreadcrumbItem[] = [
    { label: HOME_LABEL, href: HOME_HREF },
    ...withoutDuplicateHome,
  ];

  return finalizeChain(chain, normalizedPath);
}
