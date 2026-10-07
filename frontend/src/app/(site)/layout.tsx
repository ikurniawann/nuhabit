import type { Metadata } from "next";
import { SiteLayout } from "@/features/site/site-layout";

export const metadata: Metadata = {
  title: { default: "NüHabit", template: "%s | NüHabit" },
  description: "Gym HYROX dengan program 8 minggu yang terukur. Coba gratis di cabang terdekat.",
};

export const dynamic = "force-dynamic";

export default function PublicSiteLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <SiteLayout>{children}</SiteLayout>;
}
