import { requireIamPage } from "@/lib/auth/require-user";
import { StudioMemberFlagsPage } from "@/features/studio";

export const metadata = { title: "Member Perhatian Khusus" };

export default async function Page() {
  await requireIamPage(["studio.member-flags"]);
  return <StudioMemberFlagsPage />;
}
