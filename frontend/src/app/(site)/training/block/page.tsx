import type { Metadata } from "next";
import { TrainingBlockPage } from "@/features/site/components/training-page";
import { fetchContent } from "@/features/site/lib/public-api";

export const metadata: Metadata = { title: "Training block" };

export default async function Page() {
  return <TrainingBlockPage block={(await fetchContent("training")).block} />;
}
