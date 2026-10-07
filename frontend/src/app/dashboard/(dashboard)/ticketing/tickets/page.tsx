import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { TicketsPage } from "@/features/ticketing/products";

// Master Ticket = wewenang Super Admin (konsisten pengaturan master Fase A)
export default async function TicketingTicketsRoute() {
  const user = await requireUser();
  if (user.role !== "super_admin") {
    redirect("/dashboard");
  }
  return <TicketsPage />;
}
