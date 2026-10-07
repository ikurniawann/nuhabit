import type { Metadata } from "next";
import { TrainingPage } from "@/features/site/components/training-page";
import { fetchContent } from "@/features/site/lib/public-api";

export const metadata: Metadata = { title: "Training" };

export default async function Page() {
  return <TrainingPage training={await fetchContent("training")} />;
}
