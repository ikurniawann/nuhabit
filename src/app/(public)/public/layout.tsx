import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Hubungi NüHabit",
  description: "Kirim permintaan penawaran acara, katering, atau kerja sama ke NüHabit.",
};

export default function PublicFormLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
