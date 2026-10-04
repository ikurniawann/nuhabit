import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { PromoPage } from "@/features/promo";

// EPIC-032 — pengelola promo: super_admin + marketing (role marketing
// di-provision penuh di Task A4).
const PROMO_MANAGER_ROLES = ["super_admin", "marketing"];

export default async function PromoRoute() {
  const user = await requireUser();
  if (!PROMO_MANAGER_ROLES.includes(user.role)) {
    redirect("/dashboard");
  }
  return <PromoPage />;
}
