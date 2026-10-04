import { AccountDetailPage } from "@/features/sales-funnel/accounts";

export default async function SalesFunnelAccountDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AccountDetailPage accountId={id} />;
}
