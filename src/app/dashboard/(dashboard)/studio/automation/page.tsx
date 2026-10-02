import { requireIamPage } from "@/lib/auth/require-user";
import { StudioAutomationPage } from "@/features/studio";

export const metadata = { title: "Otomasi & Pengingat" };

export default async function Page() {
  await requireIamPage(["studio.automation"]);
  return <StudioAutomationPage />;
}
