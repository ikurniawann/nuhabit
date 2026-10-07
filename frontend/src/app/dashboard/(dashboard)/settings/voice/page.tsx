import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { VoiceSettingsPage } from "@/features/configuration/voice";

export default async function VoiceSettingsRoute() {
  await requireIamPage(IAM.settingsAppearance);
  return <VoiceSettingsPage />;
}
