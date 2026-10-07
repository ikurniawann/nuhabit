import type { Metadata } from "next";
import { WholesaleShell } from "@/features/shop/wholesale-portal";

export const metadata: Metadata = {
  title: "Portal Mitra Wholesale — NüHabit",
  robots: { index: false },
};

/** Portal mitra (B2B): kerangka sendiri, tanpa chrome dashboard. */
export default function WholesaleLayout({ children }: { children: React.ReactNode }) {
  return <WholesaleShell>{children}</WholesaleShell>;
}
