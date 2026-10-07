import { PassStatusPage } from "@/features/ticketing/booking-public/pass-status-page";

export const metadata = { title: "Status Season Pass", robots: { index: false } };

export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <PassStatusPage token={token} />;
}
