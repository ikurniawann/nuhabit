import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { StudioAttendancePage } from "@/features/studio";

export const metadata = { title: "Check-in & Booking" };

export default async function Page() {
  await requireIamPage(IAM.studio);
  return <StudioAttendancePage />;
}
