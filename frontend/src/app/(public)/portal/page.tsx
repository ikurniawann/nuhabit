import type { Metadata } from "next";
import { ApplicationPage } from "./_components/application-page";

export const metadata: Metadata = { title: "Apply | NüHabit", robots: { index: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** First query-string value; empty ("brand_id=") counts as absent. */
const param = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || null;

/** /portal?job_opening_id=&position_id=&brand_id=: the public application form. */
export default async function PortalPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  return (
    <ApplicationPage
      brandId={param(sp.brand_id)}
      positionId={param(sp.position_id)}
      jobOpeningId={param(sp.job_opening_id)}
    />
  );
}
