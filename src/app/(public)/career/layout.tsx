import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Careers | BCD Coffee",
  description:
    "Explore open roles and apply to join the BCD Coffee team.",
};

export default function CareerLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
