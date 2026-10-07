import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { TicketEditorPage } from "@/features/ticketing/products";

export default async function TicketingTicketEditorRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (user.role !== "super_admin") {
    redirect("/dashboard");
  }
  const { id } = await params;
  return <TicketEditorPage productId={id} />;
}
