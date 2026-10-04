import { requireUser } from "@/lib/auth/require-user";
import { EssBerandaPage } from "@/features/hris/ess";

// Beranda Karyawan — ringkasan "hari saya" (menggantikan redirect ke absensi).
export default async function MePage() {
  await requireUser();
  return <EssBerandaPage />;
}
