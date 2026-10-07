import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { UsersListPage } from "@/features/users";

// Manajemen User (IAM) — akun login, role, reset password, buat akun.
// Terpisah dari direktori Karyawan (/dashboard/employees).
export default async function UserManagementPage() {
  await requireIamPage(IAM.settingsUsers);
  return <UsersListPage variant="accounts" />;
}
