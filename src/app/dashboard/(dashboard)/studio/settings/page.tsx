import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { StudioSettingsPage } from "@/features/studio";

export const metadata = { title: "Aturan Booking" };

export default async function Page() {
  await requireIamPage(IAM.studio);
  return <StudioSettingsPage />;
}
