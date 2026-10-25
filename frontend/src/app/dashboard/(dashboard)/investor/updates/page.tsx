import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { InvestorUpdatesEditorPage } from "@/features/investor";

// Investor → Update untuk Investor: editor direksi (tulis, lampirkan, terbitkan).
export default async function Page() {
  await requireIamPage(IAM.investorUpdates);
  return <InvestorUpdatesEditorPage />;
}
