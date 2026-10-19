import { backendUrl } from "@/lib/env";
import goRoutes from "@/lib/go-routes.generated.json";

/**
 * Routing contract between the Next proxy and the Go API (backend/).
 *
 * Go owns every method and path it registers (go-routes.generated.json,
 * written by `make -C backend generate`). The proxy rewrites those requests
 * to BACKEND_URL and never hands them to a TypeScript handler, so each
 * business rule lives in Go only. Next serves the /api routes Go does not
 * register, such as /api/health and /api/ready.
 */

export type GoRoute = { module: string; method: string; path: string };

type Env = Record<string, string | undefined>;

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

/** Whether Go registers a route for this method and path. HEAD rides on GET. */
export function goOwnsRoute(
  pathname: string,
  method: string,
  routes: readonly GoRoute[] = goRoutes as GoRoute[],
): boolean {
  if (!pathname.startsWith("/api/")) return false;
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
 * Where the proxy sends an /api request. null: Go has no route for it and
 * Next serves it. Otherwise Go owns it and `url` is BACKEND_URL + pathname
 * (the caller appends the query), or null while BACKEND_URL is unset, in
 * which case the proxy answers 503.
 */
export function goBackendTarget(
  pathname: string,
  method: string,
  options: { routes?: readonly GoRoute[]; env?: Env } = {},
): { url: string | null } | null {
  if (!goOwnsRoute(pathname, method, options.routes)) return null;
  const base = backendUrl(options.env);
  return { url: base ? `${base}${pathname}` : null };
}
