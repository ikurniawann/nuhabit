import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { ChannelManagerPage } from "@/features/ticketing/products";

// Distribusi kanal = wewenang Super Admin (konsisten master ticketing)
export default async function TicketingChannelManagerRoute() {
  const user = await requireUser();
  if (user.role !== "super_admin") {
    redirect("/dashboard");
  }
  return <ChannelManagerPage />;
}
