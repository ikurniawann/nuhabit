import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { MenusConfigurationPage } from "@/features/configuration/menus";

export default async function MenuConfigurationPage() {
  await requireIamPage(IAM.settingsMenus);
  return <MenusConfigurationPage />;
}
