import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { ShopSettingsPage } from "@/features/shop/settings";

export default async function ShopSettingsRoute() {
  await requireIamPage(IAM.shop);
  return <ShopSettingsPage />;
}
