import { requireUser } from "@/lib/auth/require-user";
import { PerformanceReviewPage } from "@/features/hris/kpi";

export default async function Page() {
  await requireUser();
  return <PerformanceReviewPage />;
}
