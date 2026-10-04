import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { ResortReservationsPage } from "@/features/resort";

export const metadata = { title: "Reservasi Resort" };

export default async function Page() {
  await requireIamPage(IAM.resort);
  return <ResortReservationsPage />;
}
