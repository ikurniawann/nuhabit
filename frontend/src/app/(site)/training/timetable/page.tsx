import type { Metadata } from "next";
import { cookies } from "next/headers";
import { TimetableSection } from "@/features/site/components/timetable-page";
import { PageHero } from "@/features/site/components/site-section";
import { BRANCH_COOKIE } from "@/features/site/lib/branch-cookie";

export const metadata: Metadata = { title: "Class timetable" };

type Props = { searchParams: Promise<{ branch?: string }> };

export default async function Page({ searchParams }: Props) {
  const branchSlug = (await searchParams).branch || (await cookies()).get(BRANCH_COOKIE)?.value || undefined;
  return (
    <>
      <PageHero kicker="Timetable" title="Find your class." text="Pick a branch and a week. Times are in Western Indonesia Time (WIB)." />
      <TimetableSection branchSlug={branchSlug} />
    </>
  );
}
