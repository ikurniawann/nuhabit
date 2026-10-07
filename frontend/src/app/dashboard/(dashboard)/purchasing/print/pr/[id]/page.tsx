import { PrintPRPage } from "@/features/purchasing/print";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <PrintPRPage params={params} />;
}
