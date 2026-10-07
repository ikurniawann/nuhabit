import { requireUser } from "@/lib/auth/require-user";
import { EssKpiPage } from "@/features/hris/kpi";

export default async function KpiPage() {
  await requireUser();
  return <EssKpiPage />;
}
