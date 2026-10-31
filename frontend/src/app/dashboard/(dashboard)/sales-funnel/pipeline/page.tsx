import { SalesFunnelPipelinePage } from "@/features/sales-funnel/pipeline";

export default async function SalesFunnelPipelineRoute({
  searchParams,
}: {
  searchParams: Promise<{ deal?: string | string[] }>;
}) {
  const { deal } = await searchParams;
  return <SalesFunnelPipelinePage initialDealId={typeof deal === "string" ? deal : null} />;
}
