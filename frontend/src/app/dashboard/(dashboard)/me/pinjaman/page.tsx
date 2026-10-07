import { requireUser } from "@/lib/auth/require-user";
import { EssPinjamanPage } from "@/features/hris/ess";

export default async function PinjamanPage() {
  await requireUser();
  return <EssPinjamanPage />;
}
