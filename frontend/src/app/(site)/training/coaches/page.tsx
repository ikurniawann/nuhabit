import type { Metadata } from "next";
import { CoachesPage } from "@/features/site/components/training-profiles";
import { fetchTraining } from "@/features/site/lib/public-api";

export const metadata: Metadata = { title: "Coaches" };

export default async function Page() {
  return <CoachesPage coaches={(await fetchTraining()).coaches} />;
}
