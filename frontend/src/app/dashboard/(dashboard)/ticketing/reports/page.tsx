import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { TicketingReportsPage } from "@/features/ticketing/reports";

export default async function TicketingReportsRoute() {
  await requireIamPage(IAM.ticketingReports);
  return <TicketingReportsPage />;
}
