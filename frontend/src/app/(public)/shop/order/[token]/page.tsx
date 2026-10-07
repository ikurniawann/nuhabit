import { ShopOrderStatusPage } from "@/features/shop/storefront-public";

export const metadata = { title: "Order Status | NüHabit", robots: { index: false } };

export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <div lang="en">
      <ShopOrderStatusPage token={token} />
    </div>
  );
}
