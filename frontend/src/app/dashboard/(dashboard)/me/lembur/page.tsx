import { requireUser } from "@/lib/auth/require-user";
import { EssLemburPage } from "@/features/hris/ess";

export default async function LemburPage() {
  await requireUser();
  return <EssLemburPage />;
}
