import { OsDesktopLoader } from "@/features/os-desktop/components/os-desktop-loader";
import { redirect } from "next/navigation";
import { HomePage } from "@/features/site/components/home-page";
import { fetchBranches, fetchContent } from "@/features/site/lib/public-api";
import { SiteLayout } from "@/features/site/site-layout";
import { getUser } from "@/lib/auth/require-user";
import { isEssOnlyUser } from "@/lib/iam/get-user-menus";

export const dynamic = "force-dynamic";

/** Signed-in staff keep the OS desktop; visitors and members get the public home. */
export default async function HomeRoute() {
  const { user } = await getUser();

  if (!user) {
    const [home, branches] = await Promise.all([fetchContent("home"), fetchBranches()]);
    return (
      <SiteLayout>
        <HomePage home={home} branches={branches} />
      </SiteLayout>
    );
  }
  // User ESS-only (per IAM) tidak punya desktop NüHabit OS → langsung ke Area Karyawan.
  if (await isEssOnlyUser(user.id, user.role)) {
    redirect("/dashboard/me");
  }

  return <OsDesktopLoader />;
}
