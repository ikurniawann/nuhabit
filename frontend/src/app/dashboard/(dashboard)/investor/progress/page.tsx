import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { InvestorProgressPage } from "@/features/investor";

// Investor → Progres: update yang diterbitkan direksi.
export default async function Page() {
  await requireIamPage(IAM.investor);
  return <InvestorProgressPage />;
}
