import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { ContractsListPage } from "@/features/hris/contracts";

// HRIS → Kontrak: daftar kontrak karyawan yang akan segera berakhir
// (filter rentang/tipe/status + sort per kolom).
export default async function HrisContractsPage() {
  await requireIamPage(IAM.hrisKepegawaian);
  return <ContractsListPage />;
}
