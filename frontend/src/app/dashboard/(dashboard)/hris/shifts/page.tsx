import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { ShiftsPage } from "@/features/hris/shifts";

export default async function HrisShiftsPage() {
  await requireIamPage(IAM.hrisKepegawaian);
  return <ShiftsPage />;
}
