import { requireIamPage } from "@/lib/auth/require-user";
import { StudioNewsPage } from "@/features/studio";

export const metadata = { title: "News Hyrox" };

export default async function Page() {
  await requireIamPage(["studio.news"]);
  return <StudioNewsPage />;
}
