import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { ExpiringStockPage } from "@/features/inventory/expiry";

export default async function Page() {
  await requireIamPage(IAM.itemsInventory);
  return <ExpiringStockPage />;
}
