import { ShopStorefrontPage } from "@/features/shop/storefront-public";

export const metadata = { title: "Apparel", robots: { index: false } };

/** /apparel: toko utama (storefront is_default, atau yang pertama aktif). */
export default function ApparelPage() {
  return <ShopStorefrontPage slug="default" />;
}
