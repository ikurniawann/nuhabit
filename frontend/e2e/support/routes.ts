import { readdirSync } from "node:fs";
import path from "node:path";

const APP_DIR = path.join(__dirname, "..", "..", "src", "app");

/**
 * Static routes under an app directory: every page.tsx whose path has no
 * dynamic segment, with route groups such as "(dashboard)" stripped.
 */
function staticRoutes(relativeDir: string): string[] {
  const routes: string[] = [];
  const walk = (dir: string, segments: string[]) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name === "page.tsx") routes.push("/" + segments.join("/"));
      if (!entry.isDirectory() || entry.name.startsWith("[") || entry.name.startsWith("_")) continue;
      const group = entry.name.startsWith("(") && entry.name.endsWith(")");
      walk(path.join(dir, entry.name), group ? segments : [...segments, entry.name]);
    }
  };
  const base = relativeDir.split("/").filter((s) => !s.startsWith("("));
  walk(path.join(APP_DIR, relativeDir), base);
  return routes.sort();
}

/** Static paths that only render with a query: /join/status needs ?purchase=<uuid> and answers 404 without it. */
const NEEDS_QUERY = new Set(["/join/status"]);

/** Public marketing site, shop and sign-in pages. */
export const PUBLIC_ROUTES = [...new Set(["/", ...staticRoutes("(site)"), "/apparel", "/login", ...staticRoutes("member/auth")])].filter(
  (route) => !NEEDS_QUERY.has(route)
);

/** Member app pages behind the member session. */
export const MEMBER_ROUTES = staticRoutes("member/(app)");

/** Staff dashboard pages behind the staff session. */
export const DASHBOARD_ROUTES = staticRoutes("dashboard");

/**
 * Every page.tsx with a dynamic segment ([id], [...path]) under src/app, as
 * browser path patterns with route groups stripped, e.g. "/dashboard/hris/payroll/[id]".
 */
export function dynamicRoutes(): string[] {
  const routes: string[] = [];
  const walk = (dir: string, segments: string[]) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name === "page.tsx" && segments.some((s) => s.startsWith("["))) {
        routes.push("/" + segments.join("/"));
      }
      if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
      const group = entry.name.startsWith("(") && entry.name.endsWith(")");
      walk(path.join(dir, entry.name), group ? segments : [...segments, entry.name]);
    }
  };
  walk(APP_DIR, []);
  return routes.sort();
}
