import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { GateMappingPage } from "@/features/ticketing/products";

// Konfigurasi gateway gate = wewenang Super Admin (konsisten Master Ticket).
export default async function TicketingMappingRoute() {
  const user = await requireUser();
  if (user.role !== "super_admin") {
    redirect("/dashboard");
  }
  return <GateMappingPage />;
}
