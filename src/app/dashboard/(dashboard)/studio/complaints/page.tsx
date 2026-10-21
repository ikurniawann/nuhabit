import { requireIamPage } from "@/lib/auth/require-user";
import { StudioComplaintsPage } from "@/features/studio";

export const metadata = { title: "Keluhan Pelanggan" };

export default async function Page() {
  await requireIamPage(["studio.complaints"]);
  return <StudioComplaintsPage />;
}
