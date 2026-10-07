import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { getSettings, SETTING_KEYS } from "@/lib/settings/app-settings";
import { CustomerDisplayPage } from "@/features/pos/cfd";

// EPIC-024 — layar customer FULLSCREEN murni: sengaja di LUAR layout
// /dashboard/pos (App Router tidak bisa opt-out layout induk) supaya
// tanpa sidebar/navbar. Guard role = pemegang menu Kasir.
// Nama & alamat venue diambil server-side dari settings company_* (profil
// perusahaan) — endpoint /api/settings/company-profile butuh role admin/hrd,
// kasir tidak punya, jadi jangan fetch dari client.
const OPERATOR_ROLES = [
  "super_admin",
  "admin",
  "pos",
  "pos_supervisor",
  "sulu_bandung_demo",
];

export default async function Page() {
  const user = await requireUser();
  if (!OPERATOR_ROLES.includes(user.role)) {
    redirect("/dashboard");
  }
  const s = await getSettings([
    SETTING_KEYS.COMPANY_LEGAL_NAME,
    SETTING_KEYS.COMPANY_ADDRESS,
    SETTING_KEYS.COMPANY_CITY,
  ]);
  return (
    <CustomerDisplayPage
      venueName={s[SETTING_KEYS.COMPANY_LEGAL_NAME]}
      venueAddress={
        s[SETTING_KEYS.COMPANY_ADDRESS] || s[SETTING_KEYS.COMPANY_CITY]
      }
    />
  );
}
