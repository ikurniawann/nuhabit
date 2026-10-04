import { requireUser } from "@/lib/auth/require-user";
import { EssPengumumanPage } from "@/features/hris/ess";

export default async function PengumumanPage() {
  await requireUser();
  return <EssPengumumanPage />;
}
