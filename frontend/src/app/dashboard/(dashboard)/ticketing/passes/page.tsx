import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { SeasonPassesPage } from "@/features/ticketing/season-passes";

const OPERATOR_ROLES = ["super_admin", "pos_supervisor", "pos"];

export default async function TicketingPassesRoute() {
  const user = await requireUser();
  if (!OPERATOR_ROLES.includes(user.role)) {
    redirect("/dashboard");
  }
  return <SeasonPassesPage />;
}
