import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { EmailSettingsPage } from "@/features/configuration/email";

/** Settings → Integrasi → Email: provider email keluar, kirim uji dan log. */
export default async function EmailIntegrationSettingsPage() {
  await requireIamPage(IAM.settingsIntegrations);
  return <EmailSettingsPage />;
}
