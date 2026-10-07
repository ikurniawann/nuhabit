import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { CampaignsPage } from "@/features/crm/campaigns";

// EPIC-033 — pengelola kampanye WA: super_admin + marketing.
const CAMPAIGN_ROLES = ["super_admin", "marketing"];

export default async function CrmCampaignsRoute() {
  const user = await requireUser();
  if (!CAMPAIGN_ROLES.includes(user.role)) {
    redirect("/dashboard");
  }
  return <CampaignsPage />;
}
