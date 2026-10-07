import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { RecruitmentDashboardPage } from "@/features/hris/dashboard";

/**
 * Dashboard rekrutmen — sebelumnya menempati /dashboard (EPIC-021).
 * Dipindah ke sini karena /dashboard kini milik ringkasan eksekutif.
 */
export default async function Page() {
  const user = await requireUser();
  if (user.role === "employee") redirect("/dashboard/me");
  return <RecruitmentDashboardPage />;
}
