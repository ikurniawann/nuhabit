import { LeadDetailPage } from "@/features/sales-funnel/leads";

export default async function SalesFunnelLeadDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <LeadDetailPage leadId={id} />;
}
