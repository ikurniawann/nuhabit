import { requireIamPage } from "@/lib/auth/require-user";
import { StudioLoyaltyPage } from "@/features/studio";

export const metadata = { title: "Program Loyalitas" };

export default async function Page() {
  await requireIamPage(["studio.loyalty"]);
  return <StudioLoyaltyPage />;
}
