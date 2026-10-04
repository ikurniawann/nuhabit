import { EditPOPage } from "@/features/purchasing/po";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <EditPOPage params={params} />;
}
