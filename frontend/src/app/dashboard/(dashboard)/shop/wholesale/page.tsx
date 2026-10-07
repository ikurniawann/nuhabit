import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { ShopWholesalePage } from "@/features/shop/wholesale";

export default async function ShopWholesaleRoute() {
  await requireIamPage(IAM.shop);
  return <ShopWholesalePage />;
}
