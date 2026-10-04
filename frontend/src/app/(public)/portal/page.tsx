import { ApplicationPage } from "./_components/application-page";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Nilai pertama query string; kosong ("brand_id=") dianggap tidak ada. */
const param = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || null;

/** /portal?job_opening_id=&position_id=&brand_id=: form lamaran publik. */
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
