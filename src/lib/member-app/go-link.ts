import { parsePortalLink, type PortalTab } from "@/lib/member-portal/links";

/**
 * Notifikasi dan web push membuka `/member?go=<tujuan>` (lib/member-portal/links).
 * Aplikasi member baru punya rute sendiri untuk tujuan gym; tujuan lain masih
 * hidup di portal tab lama di /member/v1.
 */
const APP_ROUTES: Partial<Record<PortalTab, string>> = {
  classes: "/member/classes",
  "my-classes": "/member/my-classes",
  credits: "/member/wallet",
  topup: "/member/wallet/topup",
  workout: "/member/workout",
  races: "/member/races",
  coaches: "/member/trainers",
  profile: "/member/profile",
  history: "/member/visits",
};

/** URL tujuan untuk nilai `go`; null bila kosong, tidak sah, atau memang beranda. */
export function goLinkHref(go: string | null | undefined): string | null {
  const link = parsePortalLink(go);
  if (!link) return null;
  if (link.kind === "promo") return `/member/promos/${encodeURIComponent(link.code)}`;
  if (link.tab === "home") return null;
  return APP_ROUTES[link.tab] ?? `/member/v1?go=${encodeURIComponent(link.tab)}`;
}
