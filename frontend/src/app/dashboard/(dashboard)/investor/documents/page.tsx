import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { InvestorDocumentsPage } from "@/features/investor";

// Investor → Dokumen: lampiran update yang diterbitkan.
export default async function Page() {
  await requireIamPage(IAM.investor);
  return <InvestorDocumentsPage />;
}
