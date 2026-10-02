import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Member App · NüHabit",
  description: "Book classes & Personal Training, track your sessions, and buy NüHabit passes.",
};

export const viewport: Viewport = { themeColor: "#131a1c" };

/** Member App NüHabit (EPIC-057) — berdiri sendiri, tanpa chrome dashboard. */
export default function MemberLayout({ children }: { children: React.ReactNode }) {
  return children;
}
