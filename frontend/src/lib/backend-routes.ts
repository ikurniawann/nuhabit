import { backendUrl } from "@/lib/env";
import goRoutes from "@/lib/go-routes.generated.json";

/**
 * API path prefixes switched over to the Go backend (backend/). The Next
 * proxy rewrites a request to BACKEND_URL when its path sits under one of
 * these prefixes, is not in NEXT_ONLY_ROUTES, and the Go service registers a
 * route for that method and path (go-routes.generated.json, written by
 * `make -C backend generate`).
 * Anything Go does not serve, such as an upload that writes Next's storage,
 * falls through to the TypeScript route. Removing a prefix (or unsetting
 * BACKEND_URL) sends the whole prefix back to Next.
 *
 * A prefix matches whole path segments: "/api/gym" matches "/api/gym" and
 * "/api/gym/packages" but not "/api/gymnastics".
 */
export const GO_BACKEND_PREFIXES: readonly string[] = [
  // identity
  "/api/auth/me",
  // gym-credits, gym-scheduling, gym-training, athlete, member-portal
  "/api/gym",
  "/api/member-portal",
  // ERP wave: pos-sales, pos-ops, stored-value
  "/api/pos",
  "/api/table-order",
  "/api/wallet",
  "/api/promo",
  // procurement, inventory
  "/api/purchasing",
  "/api/inventory",
  // hris, payroll, recruitment
  "/api/hris",
  "/api/master",
  "/api/candidates",
  "/api/interview",
  "/api/psikotes",
  "/api/recruitment",
  "/api/job-openings",
  "/api/positions",
  "/api/offers",
  "/api/offer",
  // crm, accounting, ticketing
  "/api/crm",
  "/api/accounting",
  "/api/finance",
  "/api/ticketing",
  // wave 3: identity, desktop, configuration, integrations, insights,
  // sales-funnel, shop and public routes, resort, dataroom
  "/api/auth",
  "/api/desktop",
  "/api/settings",
  "/api/admin",
  "/api/users",
  "/api/brands",
  "/api/sections",
  "/api/audit",
  "/api/integrations",
  "/api/payments",
  "/api/wa",
  "/api/dashboard",
  "/api/analytics",
  "/api/ai",
  "/api/sales-funnel",
  "/api/shop",
  "/api/wholesale",
  "/api/public",
  "/api/portal",
  "/api/notifications",
  "/api/resort",
  "/api/dataroom",
  "/api/share",
  // site (public site content, articles, events)
  "/api/site",
];

/**
 * Routes under a switched prefix that must stay in Next even though a Go
 * pattern matches them (a Go wildcard such as /x/{id} would otherwise take
 * /x/export). Empty since every API route runs in Go; keep it for future
 * exceptions. Next-style segments: "[id]" is one segment, "[...path]" the
 * rest.
 */
export const NEXT_ONLY_ROUTES: readonly string[] = [];

export type GoRoute = { module: string; method: string; path: string };

type Env = Record<string, string | undefined>;

function matchesPrefix(pathname: string, prefix: string): boolean {
  const p = prefix.replace(/\/+$/, "");
  return pathname === p || pathname.startsWith(`${p}/`);
}

/**
 * Whether a Go ServeMux pattern path matches pathname: "{name}" takes one
 * non-empty segment, "{name...}" the rest, "{$}" ends the match, and a
 * trailing "/" matches the whole subtree.
 */
export function matchesGoPattern(pattern: string, pathname: string): boolean {
  const want = pattern.split("/");
  const got = pathname.split("/");
  for (let i = 0; i < want.length; i++) {
    const seg = want[i];
    if (seg === "{$}") return i === got.length - 1 && got[i] === "";
    if (seg === "" && i === want.length - 1 && i > 0) return got.length > i;
    if (/^\{\w+\.\.\.\}$/.test(seg)) return true;
    if (i >= got.length) return false;
    if (/^\{\w+\}$/.test(seg)) {
      if (got[i] === "") return false;
      continue;
    }
    if (seg !== got[i]) return false;
  }
  return want.length === got.length;
}

/** Whether a Next route path ("/api/x/[id]/[...path]") matches pathname. */
export function matchesNextRoute(route: string, pathname: string): boolean {
  const want = route.split("/");
  const got = pathname.split("/");
  for (let i = 0; i < want.length; i++) {
    if (/^\[\.\.\.\w+\]$/.test(want[i])) return got.length > i;
    if (i >= got.length) return false;
    if (/^\[\w+\]$/.test(want[i])) {
      if (got[i] === "") return false;
      continue;
    }
    if (want[i] !== got[i]) return false;
  }
  return want.length === got.length;
}

function keptInNext(
  nextOnly: readonly string[],
  method: string,
  pathname: string,
): boolean {
  return nextOnly.some((entry) => {
    const [m, route] = entry.split(" ");
    return (
      (m === method || (method === "HEAD" && m === "GET")) &&
      matchesNextRoute(route, pathname)
    );
  });
}

function servedByGo(
  routes: readonly GoRoute[],
  method: string,
  pathname: string,
): boolean {
  const m = method.toUpperCase();
  return routes.some(
    (r) =>
      (r.method === "*" ||
        r.method === m ||
        (m === "HEAD" && r.method === "GET")) &&
      matchesGoPattern(r.path, pathname),
  );
}

/**
 * Absolute Go URL for an /api request (BACKEND_URL + pathname), or null when
 * BACKEND_URL is unset, the path is outside every switched prefix, or Go has
 * no route for this method and path. The caller appends the query.
 */
export function goBackendTarget(
  pathname: string,
  method: string,
  options: {
    prefixes?: readonly string[];
    routes?: readonly GoRoute[];
    nextOnly?: readonly string[];
    env?: Env;
  } = {},
): string | null {
  const base = backendUrl(options.env);
  if (!base || !pathname.startsWith("/api/")) return null;
  const prefixes = options.prefixes ?? GO_BACKEND_PREFIXES;
  if (!prefixes.some((prefix) => matchesPrefix(pathname, prefix))) return null;
  if (
    keptInNext(
      options.nextOnly ?? NEXT_ONLY_ROUTES,
      method.toUpperCase(),
      pathname,
    )
  )
    return null;
  if (!servedByGo(options.routes ?? (goRoutes as GoRoute[]), method, pathname))
    return null;
  return `${base}${pathname}`;
}
