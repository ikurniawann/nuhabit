import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BranchPage } from "@/features/site/components/branch-page";
import { fetchAllSessionsAhead, fetchBranch, fetchContent } from "@/features/site/lib/public-api";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const branch = await fetchBranch((await params).slug);
  return { title: branch ? `${branch.name}${branch.city ? `, ${branch.city}` : ""}` : "Branch" };
}

export default async function Page({ params }: Props) {
  const branch = await fetchBranch((await params).slug);
  if (!branch) notFound();
  const [sessions, training] = await Promise.all([fetchAllSessionsAhead([branch]), fetchContent("training")]);
  const coachNames = new Set(sessions.map((s) => s.coach_name));
  return <BranchPage branch={branch} sessions={sessions} coaches={training.coaches.filter((coach) => coachNames.has(coach.name))} />;
}
