/**
 * Deep link desktop: /os?open=/dashboard/pos/orders&title=Transaksi
 *
 * Dipakai notifikasi WA / e-mail / hasil Spotlight supaya langsung membuka
 * JENDELA yang tepat di dalam desktop, bukan melempar ke tab dashboard.
 * Hanya path internal /dashboard yang diterima — mencegah open redirect.
 */

/** Halaman kanonis desktop NüHabit OS; /arkiv-os lama dialihkan ke sini. */
export const OS_PATH = "/os";

export const DEEP_LINK_PARAM = "open";
export const DEEP_LINK_TITLE_PARAM = "title";

export interface DeepLinkTarget {
  path: string;
  title: string;
}

function titleFromPath(path: string): string {
  const segments = path.split("?")[0].split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? "dashboard";
  return last
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .slice(0, 40);
}

export function isSafeDashboardPath(value: string | null | undefined): boolean {
  if (!value) return false;
  // Harus path relatif ke dashboard; "//evil.com" dan "https://…" ditolak.
  if (!value.startsWith("/dashboard")) return false;
  if (value.startsWith("//")) return false;
  if (value.includes("\\")) return false;
  return !/^\/dashboard[^/?#]/.test(value) || value === "/dashboard";
}

export function parseDeepLink(params: { get(name: string): string | null }): DeepLinkTarget | null {
  const raw = params.get(DEEP_LINK_PARAM);
  if (!raw) return null;
  let path: string;
  try {
    path = decodeURIComponent(raw);
  } catch {
    path = raw;
  }
  if (!isSafeDashboardPath(path)) return null;
  const title = (params.get(DEEP_LINK_TITLE_PARAM) ?? "").trim().slice(0, 40);
  return { path, title: title || titleFromPath(path) };
}

export function buildDeepLink(path: string, title?: string): string {
  const query = new URLSearchParams({ [DEEP_LINK_PARAM]: path });
  if (title) query.set(DEEP_LINK_TITLE_PARAM, title);
  return `${OS_PATH}?${query.toString()}`;
}

/** /arkiv-os?… → /os?… dengan query utuh (deep link lama tetap membuka jendelanya). */
export function legacyOsRedirectTarget(
  searchParams: Record<string, string | string[] | undefined>
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      query.append(key, item);
    }
  }
  const qs = query.toString();
  return qs ? `${OS_PATH}?${qs}` : OS_PATH;
}
