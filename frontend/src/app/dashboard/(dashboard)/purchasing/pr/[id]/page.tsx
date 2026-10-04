import { PRDetailPage } from "@/features/purchasing/pr";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <PRDetailPage params={params} />;
}
