import { WholesaleOrderDetailPage } from "@/features/shop/wholesale-portal";

export default async function WholesaleOrderRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WholesaleOrderDetailPage id={id} />;
}
