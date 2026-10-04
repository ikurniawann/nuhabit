import { backendUrl } from "@/lib/env";

/**
 * API path prefixes served by the Go backend (backend/). The Next proxy
 * rewrites a matching /api/** request to BACKEND_URL before its own auth
 * gate; the Go service runs the same gate. The TypeScript route stays in place,
 * so removing a prefix (or unsetting BACKEND_URL) sends traffic back to Next.
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
  // member-portal (profile stays in Next: profile/photo writes Next storage)
  "/api/member-portal/otp",
  "/api/member-portal/register",
  "/api/member-portal/verify",
  "/api/member-portal/logout",
  "/api/member-portal/me",
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

type Env = Record<string, string | undefined>;

function matchesPrefix(pathname: string, prefix: string): boolean {
  const p = prefix.replace(/\/+$/, "");
  return pathname === p || pathname.startsWith(`${p}/`);
}

/**
 * Absolute Go URL for an /api path (BACKEND_URL + pathname), or null when
 * BACKEND_URL is unset or no prefix matches. The caller appends the query.
 */
export function goBackendTarget(
  pathname: string,
  options: { prefixes?: readonly string[]; env?: Env } = {}
): string | null {
  const base = backendUrl(options.env);
  if (!base || !pathname.startsWith("/api/")) return null;
  const prefixes = options.prefixes ?? GO_BACKEND_PREFIXES;
  if (!prefixes.some((prefix) => matchesPrefix(pathname, prefix))) return null;
  return `${base}${pathname}`;
}
