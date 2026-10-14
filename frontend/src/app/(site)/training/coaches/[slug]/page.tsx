import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CoachPage } from "@/features/site/components/training-profiles";
import { fetchAllSessionsAhead, fetchBranches, fetchContent } from "@/features/site/lib/public-api";
import { findBySlug } from "@/features/site/lib/training";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { item } = findBySlug((await fetchContent("training")).coaches, (await params).slug);
  return { title: item ? `${item.name}, coach` : "Coach" };
}

export default async function Page({ params }: Props) {
  const training = await fetchContent("training");
  const { item: coach } = findBySlug(training.coaches, (await params).slug);
  if (!coach) notFound();
  const sessions = (await fetchAllSessionsAhead(await fetchBranches())).filter((s) => s.coach_name === coach.name);
  const classNames = new Set(sessions.map((s) => s.class_type.name));
  const classes = training.class_types.map((item, index) => ({ item, index })).filter(({ item }) => classNames.has(item.name));
  return <CoachPage coach={coach} sessions={sessions} classes={classes} others={training.coaches.filter((c) => c.name !== coach.name)} />;
}
