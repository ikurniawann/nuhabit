import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { StudioPtPage } from "@/features/studio";

export const metadata = { title: "Personal Training" };

export default async function Page() {
  await requireIamPage(IAM.studio);
  return <StudioPtPage />;
}
