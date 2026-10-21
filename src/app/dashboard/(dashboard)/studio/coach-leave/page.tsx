import { requireIamPage } from "@/lib/auth/require-user";
import { StudioCoachLeavePage } from "@/features/studio";

export const metadata = { title: "Cuti & Pengganti Coach" };

export default async function Page() {
  await requireIamPage(["studio.coach-leave"]);
  return <StudioCoachLeavePage />;
}
