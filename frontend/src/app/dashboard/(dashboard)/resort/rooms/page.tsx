import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { ResortRoomsPage } from "@/features/resort";

export const metadata = { title: "Kamar & Tipe" };

export default async function Page() {
  await requireIamPage(IAM.resort);
  return <ResortRoomsPage />;
}
