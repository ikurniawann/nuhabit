import { parsePortalLink, type PortalTab } from "@/lib/member-portal/links";

/**
 * Notifikasi dan web push membuka `/member?go=<tujuan>` (lib/member-portal/links).
 * Setiap tujuan punya rute di aplikasi member; `home` tetap di beranda.
 */
const APP_ROUTES: Record<PortalTab, string | null> = {
  home: null,
  coins: "/member/coins",
  topup: "/member/coins/topup",
  history: "/member/orders",
  profile: "/member/profile",
  events: "/member/events",
  challenges: "/member/challenges",
  promos: "/member/promos",
  rewards: "/member/rewards",
  badges: "/member/badges",
  collection: "/member/collection",
  reviews: "/member/reviews",
  classes: "/member/classes",
  "my-classes": "/member/my-classes",
  credits: "/member/wallet",
  workout: "/member/workout",
  races: "/member/races",
  coaches: "/member/trainers",
};

/** URL tujuan untuk nilai `go`; null bila kosong, tidak sah, atau memang beranda. */
export function goLinkHref(go: string | null | undefined): string | null {
  const link = parsePortalLink(go);
  if (!link) return null;
  if (link.kind === "promo") return `/member/promos/${encodeURIComponent(link.code)}`;
  return APP_ROUTES[link.tab];
}
