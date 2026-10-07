import type { Metadata } from "next";
import { ContactPage } from "@/features/site/components/contact-page";
import { fetchBranches, fetchContent } from "@/features/site/lib/public-api";

export const metadata: Metadata = { title: "Contact" };

export default async function Page() {
  const [social, branches] = await Promise.all([fetchContent("social"), fetchBranches()]);
  return <ContactPage social={social} branches={branches} />;
}
