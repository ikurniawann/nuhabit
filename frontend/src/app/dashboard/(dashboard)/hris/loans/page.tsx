import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { LoansPage } from "@/features/hris/loans";

// HRIS → Kepegawaian → Pinjaman: kasbon/pinjaman + approval + pelunasan.
export default async function HrisLoansPage() {
  await requireIamPage(IAM.hrisLoans);
  return <LoansPage />;
}
