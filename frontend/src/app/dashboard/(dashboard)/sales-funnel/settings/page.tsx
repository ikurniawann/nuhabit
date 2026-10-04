import { requireIamPage } from "@/lib/auth/require-user";
import { FunnelSettingsPage } from "@/features/sales-funnel/settings";

export default async function SalesFunnelSettingsRoute() {
  await requireIamPage(["sales-funnel.settings"], "/dashboard/sales-funnel/pipeline");
  return <FunnelSettingsPage />;
}
