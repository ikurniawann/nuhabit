import ArkivOsDesktopLoader from "@/components/arkiv/arkiv-os-desktop-loader";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth/require-user";
import { isEssOnlyUser } from "@/lib/iam/get-user-menus";

export default async function HomePage() {
  const { user } = await getUser();

  if (!user) {
    redirect("/login");
  }
  // User ESS-only (per IAM) tidak punya desktop NüHabit OS → langsung ke Area Karyawan.
  if (await isEssOnlyUser(user.id, user.role)) {
    redirect("/dashboard/me");
  }

  return <ArkivOsDesktopLoader />;
}
