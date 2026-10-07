import { AppLayout } from "@/features/member-app/components/app-layout";

/** Aplikasi member NüHabit (port 1:1 apps/member): semua rute di bawah /member berbagi kerangka ini. */
export default function MemberAppLayout({ children }: { children: React.ReactNode }) {
  return <AppLayout>{children}</AppLayout>;
}
