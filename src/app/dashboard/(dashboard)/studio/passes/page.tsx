import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { StudioPassesPage } from "@/features/studio";

export const metadata = { title: "Member Pass" };

export default async function Page() {
  await requireIamPage(IAM.studio);
  return <StudioPassesPage />;
}
