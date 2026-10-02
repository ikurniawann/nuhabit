import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { StudioTemplatesPage } from "@/features/studio";

export const metadata = { title: "Template Mingguan" };

export default async function Page() {
  await requireIamPage(IAM.studio);
  return <StudioTemplatesPage />;
}
