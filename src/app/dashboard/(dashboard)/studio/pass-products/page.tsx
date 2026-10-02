import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { StudioPassProductsPage } from "@/features/studio";

export const metadata = { title: "Paket Member" };

export default async function Page() {
  await requireIamPage(IAM.studio);
  return <StudioPassProductsPage />;
}
