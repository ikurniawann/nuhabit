import { ReactNode } from "react";

// Navigasi HRIS sekarang DB-driven via sidebar utama (iam.menus).
// Halaman /dashboard/hris hanya me-redirect ke /dashboard/hris/candidates,
// jadi layout ini cukup pass-through tanpa menu hardcode.
export default function HRISLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
