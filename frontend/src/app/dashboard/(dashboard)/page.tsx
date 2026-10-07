import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { ExecutiveDashboardPage } from "@/features/dashboard/executive";

/**
 * Landing /dashboard (EPIC-021, keputusan owner 2026-07-21):
 * - super_admin + direksi → Ringkasan Eksekutif lintas modul.
 * - employee → Area Karyawan (aturan lama dipertahankan).
 * - Role lain diarahkan ke dashboard modul yang paling relevan dengan
 *   pekerjaannya (Fase B) — bukan lagi semua ke rekrutmen:
 *   purchasing → dashboard purchasing; pos → dashboard POS;
 *   finance → payroll; sisanya (hrd, admin, dst) → dashboard rekrutmen,
 *   konten yang sama dengan yang mereka lihat sebelum halaman ini berubah.
 */

const ROLE_HOME: Record<string, string> = {
  purchasing_admin: "/dashboard/purchasing",
  purchasing_manager: "/dashboard/purchasing",
  purchasing_staff: "/dashboard/purchasing",
  pos: "/dashboard/pos",
  pos_supervisor: "/dashboard/pos",
  finance_staff: "/dashboard/hris/payroll",
};

export default async function Page() {
  const user = await requireUser();
  if (user.role === "employee") redirect("/dashboard/me");
  if (user.role === "super_admin" || user.role === "direksi") {
    return <ExecutiveDashboardPage />;
  }
  redirect(ROLE_HOME[user.role] ?? "/dashboard/rekrutmen");
}
