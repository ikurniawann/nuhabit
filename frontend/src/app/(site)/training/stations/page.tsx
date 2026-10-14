import type { Metadata } from "next";
import { StationsPage } from "@/features/site/components/training-profiles";
import { fetchContent } from "@/features/site/lib/public-api";

export const metadata: Metadata = { title: "HYROX stations" };

export default async function Page() {
  return <StationsPage stations={(await fetchContent("training")).stations} />;
}
