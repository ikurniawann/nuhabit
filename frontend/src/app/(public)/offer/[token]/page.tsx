import { OfferPortalPage } from "@/features/offer-portal";

export const metadata = { title: "Penawaran Kerja", robots: { index: false } };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <OfferPortalPage token={token} />;
}
