import { InterviewPortalPage } from "@/features/interview-portal";

export const metadata = { title: "Interview Online", robots: { index: false } };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InterviewPortalPage token={token} />;
}
