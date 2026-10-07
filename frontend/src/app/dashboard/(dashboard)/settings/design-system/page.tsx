import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { DesignSystemShowcase } from "@/features/design-system/components/design-system-showcase";

export default async function DesignSystemPage() {
  await requireIamPage(IAM.settingsAppearance);
  return <DesignSystemShowcase />;
}
