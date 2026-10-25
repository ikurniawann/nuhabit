import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { InvestorOverviewPage } from "@/features/investor";

// Investor → Ringkasan: KPI, pendapatan 90 hari per stream dan cabang.
export default async function Page() {
  await requireIamPage(IAM.investor);
  return <InvestorOverviewPage />;
}
