import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { HolidaysPage } from "@/features/hris/holidays";

export default async function HrisHolidaysPage() {
  await requireIamPage(IAM.hrisWorkforce);
  return <HolidaysPage />;
}
