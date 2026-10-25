import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { MyTasksPage } from "@/features/tasks";

// Tugas Saya: daftar tugas sendiri per hari, minggu dan bulan.
export default async function TasksPage() {
  await requireIamPage(IAM.tasks);
  return (
    <div className="p-6">
      <MyTasksPage />
    </div>
  );
}
