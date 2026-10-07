import { PrintPOPage } from "@/features/purchasing/print";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <PrintPOPage params={params} />;
}
