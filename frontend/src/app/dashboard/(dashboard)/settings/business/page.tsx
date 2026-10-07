import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { BusinessConfigurationPage } from "@/features/configuration/business";
import { CompanyProfileCard } from "@/features/configuration/business/components/company-profile-card";
import { ReceiptSettingsCard } from "@/features/configuration/business/components/receipt-settings-card";

export default async function BusinessSettingsPage() {
  await requireIamPage(IAM.settingsBusiness);
  return (
    <div className="space-y-6">
      <BusinessConfigurationPage />
      <CompanyProfileCard />
      <ReceiptSettingsCard />
    </div>
  );
}
