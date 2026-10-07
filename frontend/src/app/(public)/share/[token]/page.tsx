import { SharePage } from "@/features/dataroom/public/share-page";

export const metadata = { title: "Berkas dibagikan · Dataroom", robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SharePage token={token} />;
}
