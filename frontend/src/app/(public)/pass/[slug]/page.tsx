import { PassPurchase } from "@/features/ticketing/booking-public/pass-purchase";

export const metadata = { title: "Beli Season Pass", robots: { index: false } };

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <PassPurchase slug={slug} />;
}
