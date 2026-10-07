import { requireUser } from "@/lib/auth/require-user";
import { DeptTasksPage } from "@/features/hris/kpi";

export default async function Page() {
  await requireUser();
  return <DeptTasksPage />;
}
