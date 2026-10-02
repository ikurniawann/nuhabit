import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Member App · NüHabit",
  description: "Booking kelas & Personal Training, cek sisa sesi, dan beli paket NüHabit.",
};

export const viewport: Viewport = { themeColor: "#131a1c" };

/** Member App NüHabit (EPIC-057) — berdiri sendiri, tanpa chrome dashboard. */
export default function MemberLayout({ children }: { children: React.ReactNode }) {
  return children;
}
