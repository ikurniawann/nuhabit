import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Coach Portal · NüHabit" };
export const viewport: Viewport = { themeColor: "#00281a" };

export default function CoachLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-dvh bg-nh-forest text-nh-beige">{children}</div>;
}
