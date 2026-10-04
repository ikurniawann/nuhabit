import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { OvertimePage } from "@/features/hris/overtime";

// HRIS → Kepegawaian → Lembur: approval pengajuan + penugasan perusahaan.
export default async function HrisOvertimePage() {
  await requireIamPage(IAM.hrisKepegawaian);
  return <OvertimePage />;
}
