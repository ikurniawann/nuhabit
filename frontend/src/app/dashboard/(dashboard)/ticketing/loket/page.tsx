import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { LoketPage } from "@/features/ticketing/visits";

const OPERATOR_ROLES = ["super_admin", "pos_supervisor", "pos"];

const VOID_ROLES = ["super_admin", "pos_supervisor"];

export default async function TicketingLoketRoute() {
  const user = await requireUser();
  if (!OPERATOR_ROLES.includes(user.role)) {
    redirect("/dashboard");
  }
  return <LoketPage canVoidCharges={VOID_ROLES.includes(user.role)} />;
}
