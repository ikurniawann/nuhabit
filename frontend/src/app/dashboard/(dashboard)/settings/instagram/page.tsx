import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { InstagramSettingsPage } from "@/features/configuration/instagram";

export default async function InstagramSettingsRoute() {
  await requireIamPage(IAM.settingsIntegrations);
  return <InstagramSettingsPage />;
}
