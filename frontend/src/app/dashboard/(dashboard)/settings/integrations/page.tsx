import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { IntegrationsPage } from "@/features/configuration/integrations";

export default async function IntegrationsSettingsPage() {
  await requireIamPage(IAM.settingsIntegrations);
  return <IntegrationsPage />;
}
