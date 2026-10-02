import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { StudioSchedulePage } from "@/features/studio";

export const metadata = { title: "Jadwal Kelas" };

export default async function Page() {
  await requireIamPage(IAM.studio);
  return <StudioSchedulePage />;
}
