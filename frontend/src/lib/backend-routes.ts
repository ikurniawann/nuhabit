import { backendUrl } from "@/lib/env";
import goRoutes from "@/lib/go-routes.generated.json";

/**
 * API path prefixes switched over to the Go backend (backend/). The Next
 * proxy rewrites a request to BACKEND_URL when its path sits under one of
 * these prefixes AND the Go service registers a route for that method and
 * path (go-routes.generated.json, written by `make -C backend generate`).
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
  // gym-credits
  "/api/gym/packages",
  "/api/gym/credits",
  "/api/gym/rules",
  "/api/member-portal/gym/credits",
  // gym-scheduling
  "/api/gym/class-types",
  "/api/gym/coaches",
  "/api/gym/sessions",
  "/api/gym/bookings",
  "/api/gym/checkin",
  "/api/member-portal/gym/sessions",
  "/api/member-portal/gym/bookings",
  "/api/member-portal/gym/coaches",
  "/api/member-portal/app/classes",
  // gym-training
  "/api/gym/exercises",
  "/api/gym/races",
  "/api/gym/incentives",
  "/api/member-portal/gym/workouts",
  "/api/member-portal/gym/races",
  "/api/member-portal/app/workout",
  // athlete (app/home/settings rides on member-portal's app/home)
  "/api/member-portal/app/train",
  // member-portal (POST profile/photo stays in Next: it writes Next storage)
  "/api/member-portal/otp",
  "/api/member-portal/register",
  "/api/member-portal/verify",
  "/api/member-portal/logout",
  "/api/member-portal/me",
  "/api/member-portal/profile",
  "/api/member-portal/consent",
  "/api/member-portal/push",
  "/api/member-portal/notifications",
  "/api/member-portal/qr",
  "/api/member-portal/visits",
  "/api/member-portal/promos",
  "/api/member-portal/orders",
  "/api/member-portal/transactions",
  "/api/member-portal/topup",
  "/api/member-portal/events",
  "/api/member-portal/challenges",
  "/api/member-portal/reviews",
  "/api/member-portal/bills",
  "/api/member-portal/badges",
  "/api/member-portal/rewards",
  "/api/member-portal/collectibles",
  "/api/member-portal/wallpapers",
  "/api/member-portal/app/home",
];

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
    env?: Env;
  } = {},
): string | null {
  const base = backendUrl(options.env);
  if (!base || !pathname.startsWith("/api/")) return null;
  const prefixes = options.prefixes ?? GO_BACKEND_PREFIXES;
  if (!prefixes.some((prefix) => matchesPrefix(pathname, prefix))) return null;
  if (!servedByGo(options.routes ?? (goRoutes as GoRoute[]), method, pathname))
    return null;
  return `${base}${pathname}`;
}
