import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { AuditTrailPage } from "@/features/audit";

// Audit trail server-side: siapa mengubah stok, PO, GRN, pembayaran, dan kredit vendor.
export default async function Page() {
  await requireIamPage(IAM.settingsAudit);
  return <AuditTrailPage />;
}
