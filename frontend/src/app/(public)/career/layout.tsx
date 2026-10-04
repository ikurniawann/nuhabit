import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Careers | NüHabit",
  description:
    "Explore open roles and apply to join the NüHabit team.",
};

export default function CareerLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
