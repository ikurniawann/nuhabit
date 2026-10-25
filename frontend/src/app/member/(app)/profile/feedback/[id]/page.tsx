import { FeedbackDetailPage } from "@/features/member-app/feedback/feedback-detail-page";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FeedbackDetailPage id={id} />;
}
