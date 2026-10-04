import { BookingStatusPage } from "@/features/ticketing/booking-public/booking-status-page";

export const metadata = { title: "Status Booking", robots: { index: false } };

export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <BookingStatusPage token={token} />;
}
