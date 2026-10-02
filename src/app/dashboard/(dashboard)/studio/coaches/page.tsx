import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { StudioCoachesPage } from "@/features/studio";

export const metadata = { title: "Coach" };

export default async function Page() {
  await requireIamPage(IAM.studio);
  return <StudioCoachesPage />;
}
