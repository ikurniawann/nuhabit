import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { ShopOrdersPage } from "@/features/shop/orders";

export default async function ShopOrdersRoute() {
  await requireIamPage(IAM.shop);
  return <ShopOrdersPage />;
}
