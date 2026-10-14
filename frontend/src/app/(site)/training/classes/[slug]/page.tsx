import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ClassPage } from "@/features/site/components/training-page";
import { BRANCH_COOKIE } from "@/features/site/lib/branch-cookie";
import { fetchAllSessionsAhead, fetchBranches, fetchContent } from "@/features/site/lib/public-api";
import { findBySlug } from "@/features/site/lib/training";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { item } = findBySlug((await fetchContent("training")).class_types, (await params).slug);
  return { title: item ? item.name : "Class" };
}

export default async function Page({ params }: Props) {
  const training = await fetchContent("training");
  const { item, index } = findBySlug(training.class_types, (await params).slug);
  if (!item) notFound();
  const [branches, cookieStore] = await Promise.all([fetchBranches(), cookies()]);
  const branch = branches.find((b) => b.slug === cookieStore.get(BRANCH_COOKIE)?.value) ?? branches[0] ?? null;
  const classSessions = (await fetchAllSessionsAhead(branches)).filter((s) => s.class_type.name === item.name);
  const coachNames = new Set(classSessions.map((s) => s.coach_name));
  return (
    <ClassPage
      item={item}
      index={index}
      others={training.class_types.filter((_, i) => i !== index)}
      branch={branch}
      sessions={classSessions.filter((s) => s.branch.slug === branch?.slug).slice(0, 3)}
      coaches={training.coaches.filter((coach) => coachNames.has(coach.name))}
    />
  );
}
