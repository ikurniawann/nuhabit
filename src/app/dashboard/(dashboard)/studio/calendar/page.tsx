import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { StudioCalendarPage } from "@/features/studio";

export const metadata = { title: "Kalender Kelas" };

export default async function Page() {
  await requireIamPage(IAM.studio);
  return <StudioCalendarPage />;
}
