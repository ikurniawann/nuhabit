import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { RolesConfigurationPage } from "@/features/configuration/roles";

export default async function RolePermissionPage() {
  await requireIamPage(IAM.settingsRoles);
  return <RolesConfigurationPage />;
}
