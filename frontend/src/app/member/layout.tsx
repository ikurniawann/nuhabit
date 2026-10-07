import type { Metadata, Viewport } from "next";
import { MemberLanguage } from "@/features/member-app/components/member-language";

export const metadata: Metadata = {
  title: "Portal Member — NüHabit",
  description: "Check your ARK Coin balance, XP, tier, and transaction history.",
  // PWA "NüHabit Member": manifest + ikon di public/member-assets (lolos proxy host member).
  manifest: "/member-assets/manifest.webmanifest",
  applicationName: "NüHabit Member",
  appleWebApp: { capable: true, title: "NüHabit", statusBarStyle: "default" },
  icons: { apple: "/member-assets/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#f3ece2",
  viewportFit: "cover",
};

/** Layout portal member: berdiri sendiri, tanpa chrome dashboard internal. */
export default function MemberPortalLayout({ children }: { children: React.ReactNode }) {
  return <MemberLanguage>{children}</MemberLanguage>;
}
