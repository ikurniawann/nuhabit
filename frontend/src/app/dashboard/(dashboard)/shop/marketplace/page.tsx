import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { ShopMarketplacePage } from "@/features/shop/marketplace";

export default async function ShopMarketplaceRoute() {
  await requireIamPage(IAM.shop);
  return <ShopMarketplacePage />;
}
