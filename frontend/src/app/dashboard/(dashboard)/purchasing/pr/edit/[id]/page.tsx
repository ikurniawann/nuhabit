import { EditPRPage } from "@/features/purchasing/pr";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <EditPRPage params={params} />;
}
