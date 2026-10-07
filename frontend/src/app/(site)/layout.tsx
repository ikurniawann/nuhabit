import type { Metadata } from "next";
import { SiteLayout } from "@/features/site/site-layout";

export const metadata: Metadata = {
  title: { default: "NüHabit", template: "%s | NüHabit" },
  description: "A HYROX gym with a measurable 8-week program. Start a free trial at your nearest branch.",
};

export const dynamic = "force-dynamic";

export default function PublicSiteLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <SiteLayout>{children}</SiteLayout>;
}
