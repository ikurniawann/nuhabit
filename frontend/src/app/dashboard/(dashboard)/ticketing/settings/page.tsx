import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { TicketingSettingsPage } from "@/features/ticketing/masters";

// Fase A: pengaturan master ticketing = wewenang Super Admin (menu juga
// hanya di-grant super_admin). Role operasional loket/gate menyusul Fase B.
export default async function TicketingSettingsRoute() {
  const user = await requireUser();
  if (user.role !== "super_admin") {
    redirect("/dashboard");
  }
  return <TicketingSettingsPage />;
}
