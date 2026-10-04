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
  "/api/public",
  "/api/portal",
  "/api/notifications",
  "/api/resort",
  "/api/dataroom",
  "/api/share",
];

/**
 * Routes under a switched prefix that stay in Next: uploads and files in
 * Next's storage, xlsx/pdf output, OCR and AI extraction, and routes that
 * follow the sidebar's active stall. Listed explicitly because a Go wildcard
 * can match them (GET /api/hris/attendance/{id} would take .../export). This
 * is also the remaining work list for the Go port. Next-style segments:
 * "[id]" is one segment, "[...path]" the rest.
 */
export const NEXT_ONLY_ROUTES: readonly string[] = [
  "POST /api/accounting/chart-of-accounts/import",
  "POST /api/ai/assistant/attachment",
  "DELETE /api/candidates/[id]",
  "GET /api/candidates/[id]/ai-analysis",
  "POST /api/candidates/[id]/ai-analysis",
  "DELETE /api/candidates/[id]/cv-upload",
  "POST /api/candidates/[id]/cv-upload",
  "GET /api/candidates/[id]/report",
  "POST /api/candidates/cv-extract",
  "POST /api/crm/avatars/upload",
  "POST /api/crm/engagement/announcements/image",
  "GET /api/crm/report-builder/[id]/export",
  "GET /api/crm/reports/conversations",
  "DELETE /api/dataroom/nodes/[id]",
  "GET /api/dataroom/nodes/[id]/download",
  "POST /api/dataroom/upload",
  "DELETE /api/desktop/wallpapers",
  "POST /api/desktop/wallpapers",
  "DELETE /api/finance/invoices/[id]/faktur-pajak",
  "GET /api/finance/invoices/[id]/faktur-pajak",
  "POST /api/finance/invoices/[id]/faktur-pajak",
  "POST /api/hris/announcements/cover",
  "GET /api/hris/announcements/cover/[...path]",
  "POST /api/hris/attendance",
  "GET /api/hris/attendance/export",
  "GET /api/hris/attendance/photo/[...path]",
  "GET /api/hris/contracts/[id]/document",
  "DELETE /api/hris/contracts/[id]/signed-document",
  "GET /api/hris/contracts/[id]/signed-document",
  "POST /api/hris/contracts/[id]/signed-document",
  "POST /api/hris/kpi/snapshot",
  "POST /api/hris/leaves/attachment",
  "GET /api/hris/leaves/attachment/[...path]",
  "GET /api/hris/payslips/[id]/pdf",
  "GET /api/interview/files/[...path]",
  "GET /api/interview/session/[token]",
  "POST /api/interview/session/[token]/answer",
  "POST /api/interview/session/[token]/proctor-event",
  "POST /api/interview/session/[token]/recording-chunk",
  "POST /api/interview/session/[token]/start",
  "GET /api/interview/sessions/[id]/recordings",
  "POST /api/member-portal/profile/photo",
  "POST /api/portal/submit",
  "GET /api/pos/orders/[id]/payment-proof",
  "GET /api/pos/reports/export",
  "GET /api/pos/reports/product-sales",
  "GET /api/pos/reports/rush-hour/export",
  "GET /api/pos/reports/transactions",
  "GET /api/psikotes/files/[...path]",
  "POST /api/psikotes/session-tests/[id]/ai-insight",
  "POST /api/psikotes/session/[token]/proctor-event",
  "POST /api/psikotes/session/[token]/tests/[testId]/upload",
  "GET /api/public/gofood-image/[file]",
  "GET /api/purchasing/export/products",
  "GET /api/purchasing/export/raw-materials",
  "GET /api/purchasing/export/suppliers",
  "POST /api/purchasing/import/products",
  "POST /api/purchasing/import/raw-materials",
  "POST /api/purchasing/import/suppliers",
  "POST /api/purchasing/import/units",
  "POST /api/purchasing/receipt-scan",
  "GET /api/purchasing/receipts/[...path]",
  "GET /api/sales-funnel/invoices/[id]/pdf",
  "POST /api/sales-funnel/leads/import",
  "GET /api/sales-funnel/quotations/[id]/pdf",
  "DELETE /api/settings/static-qris",
  "POST /api/settings/static-qris",
  "GET /api/share/[token]/files/[nodeId]",
  "GET /api/table-order/orders/[id]/payment-proof",
  "POST /api/table-order/orders/[id]/payment-proof",
  "POST /api/ticketing/products/[id]/thumbnail",
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

function keptInNext(method: string, pathname: string): boolean {
  return NEXT_ONLY_ROUTES.some((entry) => {
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
    env?: Env;
  } = {},
): string | null {
  const base = backendUrl(options.env);
  if (!base || !pathname.startsWith("/api/")) return null;
  const prefixes = options.prefixes ?? GO_BACKEND_PREFIXES;
  if (!prefixes.some((prefix) => matchesPrefix(pathname, prefix))) return null;
  if (keptInNext(method.toUpperCase(), pathname)) return null;
  if (!servedByGo(options.routes ?? (goRoutes as GoRoute[]), method, pathname))
    return null;
  return `${base}${pathname}`;
}
