import { requireIamPage } from "@/lib/auth/require-user";
import { StudioCommissionsPage } from "@/features/studio";

export const metadata = { title: "Komisi Coach" };

export default async function Page() {
  await requireIamPage(["studio.commissions"]);
  return <StudioCommissionsPage />;
}
