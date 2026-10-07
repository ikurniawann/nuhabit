import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { StockMovementsPage } from "@/features/inventory/movements";

export default async function Page() {
  await requireIamPage(IAM.itemsInventory);
  return <StockMovementsPage />;
}
