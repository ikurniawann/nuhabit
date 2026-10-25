import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { TeamBoardPage } from "@/features/tasks";

// Papan Tim: kepala departemen lolos lewat cek modul Go, jadi gerbangnya
// menu tasks; API menolak yang bukan kepala atau manajer.
export default async function TasksTeamPage() {
  await requireIamPage(IAM.tasks);
  return (
    <div className="p-6">
      <TeamBoardPage />
    </div>
  );
}
