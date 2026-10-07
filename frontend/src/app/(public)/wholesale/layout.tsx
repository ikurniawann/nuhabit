import type { Metadata } from "next";
import { WholesaleShell } from "@/features/shop/wholesale-portal";

export const metadata: Metadata = {
  title: "Wholesale Partner Portal | NüHabit",
  robots: { index: false },
};

/** Partner portal (B2B): its own shell, no dashboard chrome. */
export default function WholesaleLayout({ children }: { children: React.ReactNode }) {
  return <WholesaleShell>{children}</WholesaleShell>;
}
