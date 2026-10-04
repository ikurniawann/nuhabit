import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { LoansPage } from "@/features/hris/loans";

// HRIS → Penggajian → Pinjaman: kasbon/pinjaman + approval + pelunasan.
export default async function HrisLoansPage() {
  await requireIamPage(IAM.hrisCompensation);
  return <LoansPage />;
}
