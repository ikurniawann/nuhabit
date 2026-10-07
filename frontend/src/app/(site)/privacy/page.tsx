import type { Metadata } from "next";
import { LegalPage } from "@/features/site/components/legal-page";
import { fetchContent } from "@/features/site/lib/public-api";

export const metadata: Metadata = { title: "Privacy Policy" };

export default async function Page() {
  return <LegalPage content={await fetchContent("legal_privacy")} />;
}
