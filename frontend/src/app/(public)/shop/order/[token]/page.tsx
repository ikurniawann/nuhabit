import { ShopOrderStatusPage } from "@/features/shop/storefront-public";

export const metadata = { title: "Status Pesanan", robots: { index: false } };

export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <ShopOrderStatusPage token={token} />;
}
