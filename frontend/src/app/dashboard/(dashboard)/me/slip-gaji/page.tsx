import { requireUser } from "@/lib/auth/require-user";
import { EssSlipGajiPage } from "@/features/hris/ess";

export default async function SlipGajiPage() {
  await requireUser();
  return <EssSlipGajiPage />;
}
