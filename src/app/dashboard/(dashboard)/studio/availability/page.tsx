import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { StudioAvailabilityPage } from "@/features/studio";

export const metadata = { title: "Ketersediaan Coach" };

export default async function Page() {
  await requireIamPage(IAM.studio);
  return <StudioAvailabilityPage />;
}
