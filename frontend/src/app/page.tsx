import { OsDesktopLoader } from "@/features/os-desktop/components/os-desktop-loader";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { HomePage } from "@/features/site/components/home-page";
import { BRANCH_COOKIE } from "@/features/site/lib/branch-cookie";
import { fetchArticles, fetchBranches, fetchContent, fetchEvents, fetchPlans, fetchUpcomingSessions } from "@/features/site/lib/public-api";
import { SiteLayout } from "@/features/site/site-layout";
import { getUser } from "@/lib/auth/require-user";
import { isEssOnlyUser } from "@/lib/iam/get-user-menus";

export const dynamic = "force-dynamic";

/** Signed-in staff keep the OS desktop; visitors and members get the public home. */
export default async function HomeRoute() {
  const { user } = await getUser();

  if (!user) {
    const branchSlug = (await cookies()).get(BRANCH_COOKIE)?.value || undefined;
    const [home, branches, plans, training, articles, events] = await Promise.all([
      fetchContent("home"), fetchBranches(), fetchPlans(branchSlug), fetchContent("training"), fetchArticles(), fetchEvents(),
    ]);
    const selectedBranch = branches.find((branch) => branch.slug === branchSlug) ?? branches[0];
    const now = new Date();
    const sessions = selectedBranch ? await fetchUpcomingSessions(selectedBranch.slug, now) : [];
    const upcomingEvents = events.filter((event) => new Date(event.starts_at).getTime() >= now.getTime()).slice(0, 1);
    return (
      <SiteLayout>
        <HomePage home={home} branches={branches} plans={plans} training={training} sessions={sessions} selectedBranch={selectedBranch ?? null} articles={articles.slice(0, upcomingEvents.length ? 1 : 2)} events={upcomingEvents} />
      </SiteLayout>
    );
  }
  // User ESS-only (per IAM) tidak punya desktop NüHabit OS → langsung ke Area Karyawan.
  if (await isEssOnlyUser(user.id, user.role)) {
    redirect("/dashboard/me");
  }

  return <OsDesktopLoader />;
}
