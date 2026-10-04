import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { WaGatewayPage } from "@/features/configuration/wa-gateway";

export default async function WaGatewaySettingsPage() {
  await requireIamPage(IAM.settingsWaGateway);
  return <WaGatewayPage />;
}
