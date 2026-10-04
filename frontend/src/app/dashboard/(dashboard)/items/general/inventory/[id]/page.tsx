import { SupplyInventoryDetailPage } from "@/features/purchasing/supply-inventory";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <SupplyInventoryDetailPage params={params} />;
}
