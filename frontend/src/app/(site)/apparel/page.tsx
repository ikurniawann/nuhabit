import { ShopStorefrontPage } from "@/features/shop/storefront-public";

export const metadata = { title: "Apparel", robots: { index: false } };

/** /apparel: the main store (storefront is_default, else the first active one). */
export default function ApparelPage() {
  return <ShopStorefrontPage slug="default" />;
}
