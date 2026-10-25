import { TicketDetailPage } from "@/features/gym/complaints/components/ticket-detail-page";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TicketDetailPage id={id} />;
}
