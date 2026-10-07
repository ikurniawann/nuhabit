import type { Metadata } from "next";
import { SpacePage } from "@/features/site/components/space-page";
import { fetchContent } from "@/features/site/lib/public-api";

export const metadata: Metadata = { title: "The Space" };

export default async function Page() {
  return <SpacePage space={await fetchContent("space")} />;
}
