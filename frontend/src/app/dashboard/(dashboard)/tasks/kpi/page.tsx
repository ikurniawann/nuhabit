import { Suspense } from "react";
import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { KpiTasksPage } from "@/features/tasks";

// KPI & Tugas: per indikator departemen, tugas terkait dan penyelesaiannya.
export default async function TasksKpiPage() {
  await requireIamPage(IAM.tasks);
  return (
    <div className="p-6">
      <Suspense>
        <KpiTasksPage />
      </Suspense>
    </div>
  );
}
