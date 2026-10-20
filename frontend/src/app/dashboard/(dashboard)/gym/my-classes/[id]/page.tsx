import { MySessionPage } from "@/features/gym/my-classes/components/my-session-page";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MySessionPage sessionId={id} />;
}
