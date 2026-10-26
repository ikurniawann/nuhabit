import { ShopStorefrontPage } from "@/features/shop/storefront-public";

export const metadata = { title: "Online Store", robots: { index: false } };

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <ShopStorefrontPage slug={slug} />;
}
