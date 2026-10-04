import { requireUser } from "@/lib/auth/require-user";
import { EssCutiPage } from "@/features/hris/ess";

export default async function CutiPage() {
  await requireUser();
  return <EssCutiPage />;
}
