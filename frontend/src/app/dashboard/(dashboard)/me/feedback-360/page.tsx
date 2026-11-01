import { requireUser } from "@/lib/auth/require-user";
import { EssFeedbackPage } from "@/features/hris/feedback";

export default async function FeedbackPage() {
  await requireUser();
  return <EssFeedbackPage />;
}
