import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { ShippingSettingsPage } from "@/features/shop/shipping-settings";

export default async function ShippingSettingsRoute() {
  await requireIamPage(IAM.shop);
  return <ShippingSettingsPage />;
}
