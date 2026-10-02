import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { StudioProgramsPage } from "@/features/studio";

export const metadata = { title: "Program Kelas" };

export default async function Page() {
  await requireIamPage(IAM.studio);
  return <StudioProgramsPage />;
}
