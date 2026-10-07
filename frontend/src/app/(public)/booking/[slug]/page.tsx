import { BookingWizard } from "@/features/ticketing/booking-public/booking-wizard";

export const metadata = { title: "Booking Tiket Online", robots: { index: false } };

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <BookingWizard slug={slug} />;
}
