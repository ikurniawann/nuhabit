import { requireIamPage } from "@/lib/auth/require-user";
import { StudioSopPage } from "@/features/studio";

export const metadata = { title: "SOP Coach" };

export default async function Page() {
  await requireIamPage(["studio.sop"]);
  return <StudioSopPage />;
}
