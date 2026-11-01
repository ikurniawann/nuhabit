import { requireUser } from "@/lib/auth/require-user";
import { FeedbackAdminPage } from "@/features/hris/feedback";

export default async function Page() {
  await requireUser();
  return <FeedbackAdminPage />;
}
