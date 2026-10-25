import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { InvestorPerformancePage } from "@/features/investor";

// Investor → Laporan Kinerja: tabel dan grafik bulanan, unduh CSV.
export default async function Page() {
  await requireIamPage(IAM.investor);
  return <InvestorPerformancePage />;
}
