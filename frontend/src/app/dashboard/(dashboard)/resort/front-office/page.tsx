import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { ResortFrontOfficePage } from "@/features/resort";

export const metadata = { title: "Front Office Resort" };

export default async function Page() {
  await requireIamPage(IAM.resort);
  return <ResortFrontOfficePage />;
}
