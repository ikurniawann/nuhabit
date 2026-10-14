import type { Metadata } from "next";
import { FaqPage } from "@/features/site/components/training-page";
import { fetchContent } from "@/features/site/lib/public-api";

export const metadata: Metadata = { title: "FAQ" };

export default async function Page() {
  return <FaqPage faq={(await fetchContent("training")).faq} />;
}
