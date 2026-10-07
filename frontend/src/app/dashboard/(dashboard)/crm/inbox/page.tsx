import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { CrmInboxPage } from "@/features/crm/inbox";

export default async function InboxPage() {
  await requireIamPage(IAM.crmInbox);
  return <CrmInboxPage />;
}
