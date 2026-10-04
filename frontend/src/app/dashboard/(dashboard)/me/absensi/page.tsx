import { requireUser } from "@/lib/auth/require-user";
import { EssAbsensiPage } from "@/features/hris/ess";

export default async function AbsensiPage() {
  await requireUser();
  return <EssAbsensiPage />;
}
