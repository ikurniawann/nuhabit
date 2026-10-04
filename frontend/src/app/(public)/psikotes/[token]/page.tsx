import { PsikotesPortalPage } from "@/features/psikotes-portal";

export const metadata = { title: "Psikotes Online", robots: { index: false } };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PsikotesPortalPage token={token} />;
}
