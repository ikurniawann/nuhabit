import { requireUser } from "@/lib/auth/require-user";
import { EssShiftTimPage } from "@/features/hris/ess";

export default async function ShiftTimPage() {
  await requireUser();
  return <EssShiftTimPage />;
}
